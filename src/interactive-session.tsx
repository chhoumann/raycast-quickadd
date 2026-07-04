import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
  Keyboard,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import {
  type InteractiveSession,
  type PromptSpec,
  pollSession,
  replyToPrompt,
  startInteractive,
} from "./lib/interactive";

interface PendingPrompt {
  requestId: string;
  prompt: PromptSpec;
}

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
 * run completes. Currently handles `suggester` prompts (rendered as a List).
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
  // Resolves the loop's "wait for the user's answer" promise. null = no prompt open.
  const answerRef = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    (async () => {
      try {
        const session: InteractiveSession = await startInteractive(choiceId);
        while (!cancelled) {
          const event = await pollSession(session, abort.signal);
          if (cancelled) return;
          if (event.kind === "idle") continue;
          if (event.kind === "prompt") {
            setPhase({
              state: "prompt",
              pending: { requestId: event.requestId, prompt: event.prompt },
            });
            const value = await new Promise<string | null>((resolve) => {
              answerRef.current = resolve;
            });
            answerRef.current = null;
            if (cancelled) return;
            await replyToPrompt(session, event.requestId, value);
            if (value === null) {
              setPhase({ state: "done", message: "Cancelled" });
              return;
            }
            setPhase({ state: "working" });
          } else if (event.kind === "done") {
            setPhase({ state: "done", message: `${choiceName} finished` });
            return;
          } else if (event.kind === "error") {
            setPhase({ state: "failed", message: event.error });
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
      // Unblock a parked prompt so the loop can exit cleanly.
      answerRef.current?.(null);
      answerRef.current = null;
    };
  }, [choiceId, choiceName]);

  // Report terminal states and pop back to the list.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.state]);

  if (phase.state === "prompt") {
    return (
      <SuggesterPrompt
        pending={phase.pending}
        choiceName={choiceName}
        onAnswer={(v) => answerRef.current?.(v)}
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

function SuggesterPrompt({
  pending,
  choiceName,
  onAnswer,
}: {
  pending: PendingPrompt;
  choiceName: string;
  onAnswer: (value: string | null) => void;
}) {
  const { prompt } = pending;
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
              <CancelAction onAnswer={onAnswer} />
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
                <CancelAction onAnswer={onAnswer} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

function CancelAction({
  onAnswer,
}: {
  onAnswer: (value: string | null) => void;
}) {
  return (
    <Action
      title="Cancel Run"
      icon={Icon.XMarkCircle}
      style={Action.Style.Destructive}
      shortcut={Keyboard.Shortcut.Common.Pin}
      onAction={() => onAnswer(null)}
    />
  );
}
