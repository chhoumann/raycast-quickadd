import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import {
  type FormField,
  type InteractiveSession,
  type PromptSpec,
  type ReplyValue,
  pollSession,
  replyToPrompt,
  startInteractive,
} from "./lib/interactive";

interface PendingPrompt {
  requestId: string;
  prompt: PromptSpec;
}

type Answer = { cancelled: true } | { cancelled: false; value: ReplyValue };

type Phase =
  | { state: "connecting" }
  | { state: "prompt"; pending: PendingPrompt }
  | { state: "working" }
  | { state: "done"; message: string }
  | { state: "failed"; message: string };

/**
 * Drives a QuickAdd interactive run: opens the session once, then runs a single
 * continuous poll loop that renders each runtime prompt as a native control,
 * parks until the user answers, sends the answer back, and resumes - until the
 * run completes. Covers the full prompt seam (suggester / input / date / confirm
 * / checkbox / info).
 */
export function InteractiveSessionView({
  choiceId,
  choiceName,
}: {
  choiceId: string;
  choiceName: string;
}) {
  const { pop } = useNavigation();
  const [phase, setPhase] = useState<Phase>({ state: "connecting" });
  const answerRef = useRef<((answer: Answer) => void) | null>(null);
  // Live session + the prompt we're parked on, so unmount (Escape) can send a
  // best-effort cancel and the running script doesn't hang server-side.
  const sessionRef = useRef<InteractiveSession | null>(null);
  const openRequestRef = useRef<string | null>(null);
  // Set when the user cancels a prompt, so the server's resulting abort event is
  // rendered as a clean "Cancelled" rather than a failure.
  const userCancelledRef = useRef(false);
  // Memoize the session start so React's double-invoked effect (StrictMode)
  // starts the run exactly ONCE. Without this each invoke calls
  // startInteractive -> a separate CLI run -> the script executes twice.
  const sessionPromiseRef = useRef<Promise<InteractiveSession> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    (async () => {
      try {
        if (!sessionPromiseRef.current) {
          sessionPromiseRef.current = startInteractive(choiceId);
        }
        const session: InteractiveSession = await sessionPromiseRef.current;
        sessionRef.current = session;

        // Send the user's answer WITHOUT pausing the poll loop below. Continuous
        // polling is the server's only liveness signal: if we stopped polling
        // while a prompt was open, the server couldn't tell a slow user from a
        // crashed client, and a disconnect would hang the run. So the loop keeps
        // polling (parking on idle) while this runs in the background.
        const answerPrompt = async (requestId: string) => {
          const answer = await new Promise<Answer>((resolve) => {
            answerRef.current = resolve;
          });
          answerRef.current = null;
          if (cancelled) return;
          openRequestRef.current = null;
          // Set the next visible phase synchronously (before the reply round-trip)
          // so it never races ahead of the loop's terminal event.
          if (answer.cancelled) userCancelledRef.current = true;
          else setPhase({ state: "working" });
          try {
            await replyToPrompt(
              session,
              requestId,
              answer.cancelled ? null : answer.value,
              answer.cancelled,
            );
          } catch (error) {
            if (!cancelled) {
              setPhase({
                state: "failed",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        };

        while (!cancelled) {
          const event = await pollSession(session, abort.signal);
          if (cancelled) return;
          if (event.kind === "idle") continue;
          if (event.kind === "prompt") {
            openRequestRef.current = event.requestId;
            setPhase({
              state: "prompt",
              pending: { requestId: event.requestId, prompt: event.prompt },
            });
            void answerPrompt(event.requestId);
            continue;
          }
          if (event.kind === "done") {
            setPhase({ state: "done", message: `${choiceName} finished` });
            return;
          }
          if (event.kind === "error") {
            // A user cancel aborts the run server-side; render it as a clean
            // cancellation instead of a failure.
            if (userCancelledRef.current) {
              setPhase({ state: "done", message: "Cancelled" });
            } else {
              setPhase({ state: "failed", message: event.error });
            }
            return;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPhase({
            state: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      answerRef.current?.({ cancelled: true });
      answerRef.current = null;
      // Best-effort cancel so the script's prompt doesn't park forever if the
      // user dismissed the view while a prompt was open.
      const session = sessionRef.current;
      const requestId = openRequestRef.current;
      if (session && requestId) {
        openRequestRef.current = null;
        void replyToPrompt(session, requestId, null, true).catch(() => {});
      }
    };
  }, [choiceId, choiceName]);

  useEffect(() => {
    if (phase.state === "done") {
      showToast({ style: Toast.Style.Success, title: phase.message });
      const timer = setTimeout(pop, 400);
      return () => clearTimeout(timer);
    }
    if (phase.state === "failed") {
      showFailureToast(new Error(phase.message), {
        title: `${choiceName} failed`,
      });
    }
  }, [phase.state]);

  if (phase.state === "prompt") {
    const onAnswer = (value: ReplyValue) =>
      answerRef.current?.({ cancelled: false, value });
    const onCancel = () => answerRef.current?.({ cancelled: true });
    return (
      <PromptView
        pending={phase.pending}
        choiceName={choiceName}
        onAnswer={onAnswer}
        onCancel={onCancel}
      />
    );
  }

  const isBusy = phase.state === "connecting" || phase.state === "working";
  return (
    <List
      isLoading={isBusy}
      navigationTitle={choiceName}
      searchBarPlaceholder={`Running ${choiceName}...`}
    >
      <List.EmptyView
        icon={phase.state === "failed" ? Icon.ExclamationMark : Icon.Wand}
        title={
          phase.state === "connecting"
            ? "Starting interactive run..."
            : phase.state === "working"
              ? "Working..."
              : phase.state === "failed"
                ? "Run failed"
                : "Done"
        }
        description={
          phase.state === "failed"
            ? phase.message
            : `Complete each prompt from ${choiceName} as it appears.`
        }
      />
    </List>
  );
}

interface PromptProps {
  pending: PendingPrompt;
  choiceName: string;
  onAnswer: (value: ReplyValue) => void;
  onCancel: () => void;
}

function PromptView(props: PromptProps) {
  const { prompt } = props.pending;
  switch (prompt.type) {
    case "suggester":
      return <SuggesterPrompt {...props} prompt={prompt} />;
    case "input":
      return <InputPrompt {...props} prompt={prompt} />;
    case "date":
      return <DatePrompt {...props} prompt={prompt} />;
    case "confirm":
      return <ConfirmPrompt {...props} prompt={prompt} />;
    case "checkbox":
      return <CheckboxPrompt {...props} prompt={prompt} />;
    case "info":
      return <InfoPrompt {...props} prompt={prompt} />;
    case "form":
      return <FormPrompt {...props} prompt={prompt} />;
  }
}

function CancelAction({ onCancel }: { onCancel: () => void }) {
  return (
    <Action
      title="Cancel Run"
      icon={Icon.XMarkCircle}
      style={Action.Style.Destructive}
      shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
      onAction={onCancel}
    />
  );
}

function SuggesterPrompt({
  prompt,
  choiceName,
  onAnswer,
  onCancel,
}: PromptProps & { prompt: Extract<PromptSpec, { type: "suggester" }> }) {
  const [search, setSearch] = useState("");
  const trimmed = search.trim();
  const canUseCustom =
    prompt.allowCustomInput &&
    trimmed.length > 0 &&
    !prompt.items.some(
      (item) => item.title === trimmed || item.value === trimmed,
    );

  return (
    <List
      navigationTitle={choiceName}
      searchBarPlaceholder={prompt.placeholder ?? "Select an option"}
      onSearchTextChange={setSearch}
      filtering
    >
      {canUseCustom && (
        <List.Item
          icon={Icon.Plus}
          title={`Use "${trimmed}"`}
          actions={
            <ActionPanel>
              <Action
                title="Use Custom Value"
                icon={Icon.Plus}
                onAction={() => onAnswer(trimmed)}
              />
              <CancelAction onCancel={onCancel} />
            </ActionPanel>
          }
        />
      )}
      <List.Section title={prompt.placeholder ?? "Options"}>
        {prompt.items.map((item, index) => (
          <List.Item
            key={`${item.value}-${index}`}
            icon={Icon.Dot}
            title={item.title}
            actions={
              <ActionPanel>
                <Action
                  title="Select"
                  icon={Icon.Check}
                  onAction={() => onAnswer(item.value)}
                />
                <CancelAction onCancel={onCancel} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

function InputPrompt({
  prompt,
  choiceName,
  onAnswer,
  onCancel,
}: PromptProps & { prompt: Extract<PromptSpec, { type: "input" }> }) {
  return (
    <Form
      navigationTitle={choiceName}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Submit"
            icon={Icon.Check}
            onSubmit={(values: { text: string }) => onAnswer(values.text ?? "")}
          />
          <CancelAction onCancel={onCancel} />
        </ActionPanel>
      }
    >
      {prompt.multiline ? (
        <Form.TextArea
          id="text"
          title={prompt.header}
          placeholder={prompt.placeholder}
          defaultValue={prompt.defaultValue}
        />
      ) : (
        <Form.TextField
          id="text"
          title={prompt.header}
          placeholder={prompt.placeholder}
          defaultValue={prompt.defaultValue}
        />
      )}
    </Form>
  );
}

function DatePrompt({
  prompt,
  choiceName,
  onAnswer,
  onCancel,
}: PromptProps & { prompt: Extract<PromptSpec, { type: "date" }> }) {
  const parsed = prompt.defaultValue
    ? new Date(prompt.defaultValue)
    : undefined;
  const defaultValue =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  return (
    <Form
      navigationTitle={choiceName}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Submit"
            icon={Icon.Check}
            onSubmit={(values: { date: Date | null }) =>
              onAnswer((values.date ?? new Date()).toISOString())
            }
          />
          <CancelAction onCancel={onCancel} />
        </ActionPanel>
      }
    >
      <Form.DatePicker
        id="date"
        title={prompt.header}
        defaultValue={defaultValue}
        type={
          prompt.withTime
            ? Form.DatePicker.Type.DateTime
            : Form.DatePicker.Type.Date
        }
      />
    </Form>
  );
}

function ConfirmPrompt({
  prompt,
  choiceName,
  onAnswer,
  onCancel,
}: PromptProps & { prompt: Extract<PromptSpec, { type: "confirm" }> }) {
  return (
    <List navigationTitle={choiceName} searchBarPlaceholder={prompt.header}>
      <List.Section title={prompt.header} subtitle={prompt.text}>
        <List.Item
          icon={Icon.CheckCircle}
          title="Yes"
          actions={
            <ActionPanel>
              <Action
                title="Yes"
                icon={Icon.CheckCircle}
                onAction={() => onAnswer(true)}
              />
              <CancelAction onCancel={onCancel} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Circle}
          title="No"
          actions={
            <ActionPanel>
              <Action
                title="No"
                icon={Icon.Circle}
                onAction={() => onAnswer(false)}
              />
              <CancelAction onCancel={onCancel} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

function CheckboxPrompt({
  prompt,
  choiceName,
  onAnswer,
  onCancel,
}: PromptProps & { prompt: Extract<PromptSpec, { type: "checkbox" }> }) {
  return (
    <Form
      navigationTitle={choiceName}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Submit"
            icon={Icon.Check}
            onSubmit={(values: Record<string, boolean>) =>
              onAnswer(
                prompt.items
                  .filter((item, index) => values[`item-${index}`])
                  .map((item) => item.value),
              )
            }
          />
          <CancelAction onCancel={onCancel} />
        </ActionPanel>
      }
    >
      {prompt.header ? <Form.Description text={prompt.header} /> : null}
      {prompt.items.map((item, index) => (
        <Form.Checkbox
          key={`${item.value}-${index}`}
          id={`item-${index}`}
          label={item.title}
          defaultValue={item.checked}
        />
      ))}
    </Form>
  );
}

function InfoPrompt({
  prompt,
  choiceName,
  onAnswer,
  onCancel,
}: PromptProps & { prompt: Extract<PromptSpec, { type: "info" }> }) {
  const markdown = `# ${prompt.header}\n\n${prompt.text.join("\n\n")}`;
  return (
    <Detail
      navigationTitle={choiceName}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Continue"
            icon={Icon.ArrowRight}
            onAction={() => onAnswer(true)}
          />
          <CancelAction onCancel={onCancel} />
        </ActionPanel>
      }
    />
  );
}

function FormPrompt({
  prompt,
  choiceName,
  onAnswer,
  onCancel,
}: PromptProps & { prompt: Extract<PromptSpec, { type: "form" }> }) {
  function handleSubmit(values: Record<string, unknown>) {
    const result: Record<string, string> = {};
    for (const field of prompt.fields) {
      const raw = values[field.id];
      if (raw instanceof Date) {
        // Match the one-page modal: date fields carry a raw @date:ISO the plugin
        // then formats with the field's dateFormat.
        result[field.id] = `@date:${raw.toISOString()}`;
      } else if (Array.isArray(raw)) {
        result[field.id] = raw.join(", ");
      } else {
        result[field.id] = raw == null ? "" : String(raw);
      }
    }
    onAnswer(result);
  }

  return (
    <Form
      navigationTitle={choiceName}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Submit"
            icon={Icon.Check}
            onSubmit={handleSubmit}
          />
          <CancelAction onCancel={onCancel} />
        </ActionPanel>
      }
    >
      {prompt.fields.map((field) => (
        <FormFieldControl key={field.id} field={field} />
      ))}
    </Form>
  );
}

function FormFieldControl({ field }: { field: FormField }) {
  const title = field.optional ? `${field.label} (Optional)` : field.label;
  const hasOptions = Array.isArray(field.options) && field.options.length > 0;

  if (field.type === "date") {
    const parsed = field.defaultValue
      ? new Date(field.defaultValue)
      : undefined;
    const defaultValue =
      parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
    return (
      <Form.DatePicker
        id={field.id}
        title={title}
        info={field.description}
        defaultValue={defaultValue}
        type={
          field.withTime
            ? Form.DatePicker.Type.DateTime
            : Form.DatePicker.Type.Date
        }
      />
    );
  }

  if (hasOptions) {
    const options = field.options ?? [];
    const defaultValue =
      field.defaultValue && options.includes(field.defaultValue)
        ? field.defaultValue
        : undefined;
    return (
      <Form.Dropdown
        id={field.id}
        title={title}
        info={field.description}
        defaultValue={defaultValue}
      >
        {options.map((option, index) => (
          <Form.Dropdown.Item
            key={`${option}-${index}`}
            value={option}
            title={option}
          />
        ))}
      </Form.Dropdown>
    );
  }

  if (field.type === "textarea") {
    return (
      <Form.TextArea
        id={field.id}
        title={title}
        info={field.description}
        placeholder={field.placeholder}
        defaultValue={field.defaultValue}
      />
    );
  }

  return (
    <Form.TextField
      id={field.id}
      title={title}
      info={field.description}
      placeholder={
        field.placeholder ??
        (field.type === "number" || field.type === "slider"
          ? "Number"
          : undefined)
      }
      defaultValue={field.defaultValue}
    />
  );
}
