import {
  Action,
  ActionPanel,
  Form,
  Icon,
  type LaunchProps,
  List,
  Toast,
  closeMainWindow,
  open,
  popToRoot,
  showHUD,
  showToast,
  useNavigation,
} from "@raycast/api";
import {
  createDeeplink,
  showFailureToast,
  useCachedPromise,
} from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import {
  listChoices,
  obsidianOpenUrl,
  runChoice,
  startInteractive,
} from "./lib/obsidianCli";
import { choiceIcon } from "./lib/format";
import {
  InteractiveSessionView,
  type PendingPrompt,
} from "./interactive-session";
import { type InteractiveSession, pollSession } from "./lib/interactive";
import type { ChoiceSummary, RunResponse } from "./lib/types";

type RunnableChoice = { id: string; name: string };

interface RunChoiceContext {
  /** Set when launched from a pinned Quicklink: open this choice directly. */
  choiceId?: string;
}

export default function RunChoiceCommand(props: LaunchProps) {
  const choiceId = (props.launchContext as RunChoiceContext | undefined)
    ?.choiceId;
  return choiceId ? <DirectChoice choiceId={choiceId} /> : <ChoiceList />;
}

/** A deeplink back into this command that opens one specific choice (used for pinning). */
function choiceDeeplink(choiceId: string): string {
  return createDeeplink({ command: "run-choice", context: { choiceId } });
}

function ChoiceList() {
  const { data, isLoading, error } = useCachedPromise(async () => {
    const response = await listChoices();
    if (!response.ok || !response.choices) {
      throw new Error(response.error ?? "QuickAdd returned no choices");
    }
    return response.choices.filter((choice) => choice.runnable);
  });

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could not reach QuickAdd"
          description={error.message}
        />
      </List>
    );
  }

  const sections = groupByParent(data ?? []);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search QuickAdd choices..."
    >
      {sections.map(([parent, choices]) => (
        <List.Section key={parent} title={parent}>
          {choices.map((choice) => (
            <ChoiceItem key={choice.id} choice={choice} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

/**
 * Opens one choice directly (used when launched from a pinned Quicklink). Runs it
 * interactively like the list "Run": a prompt-less run just closes with a HUD; a
 * run that raises a prompt hands off to the interactive session view.
 */
function DirectChoice({ choiceId }: { choiceId: string }) {
  const [view, setView] = useState<
    | { phase: "loading" }
    | {
        phase: "attach";
        session: InteractiveSession;
        choiceName: string;
        initialPrompt: PendingPrompt;
      }
    | { phase: "error"; message: string }
  >({ phase: "loading" });
  // Raycast double-invokes effects (StrictMode); without the ref the choice
  // runs twice.
  const startRef = useRef<ReturnType<typeof startInteractive> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    (async () => {
      try {
        startRef.current ??= startInteractive(choiceId);
        const { session, choice } = await startRef.current;
        const choiceName = choice.name;
        if (cancelled) return;

        // Pre-poll until the run either raises a prompt or finishes.
        while (!cancelled) {
          const event = await pollSession(session, abort.signal);
          if (cancelled) return;
          if (event.kind === "idle") continue;
          if (event.kind === "prompt") {
            setView({
              phase: "attach",
              session,
              choiceName,
              initialPrompt: {
                requestId: event.requestId,
                prompt: event.prompt,
              },
            });
            return;
          }
          if (event.kind === "done") {
            const result = (event.result ?? {}) as {
              ok?: boolean;
              error?: string;
              file?: string;
            };
            if (result.ok === false) {
              throw new Error(result.error ?? "Choice execution failed");
            }
            await showHUD(
              result.file
                ? `Ran ${choiceName} → ${result.file}`
                : `Ran ${choiceName}`,
            );
            await closeMainWindow();
            return;
          }
          if (event.kind === "error") {
            throw new Error(event.error);
          }
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setView({ phase: "error", message });
          await showFailureToast(e, { title: "Could not run choice" });
        }
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [choiceId]);

  if (view.phase === "attach") {
    return (
      <InteractiveSessionView
        session={view.session}
        choiceName={view.choiceName}
        initialPrompt={view.initialPrompt}
        onFinish={() => void closeMainWindow()}
      />
    );
  }
  if (view.phase === "error") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could not open choice"
          description={view.message}
        />
      </List>
    );
  }
  return <Form isLoading />;
}

/** Group runnable choices by their Multi folder path (root-level first). */
function groupByParent(
  choices: ChoiceSummary[],
): Array<[string, ChoiceSummary[]]> {
  const groups = new Map<string, ChoiceSummary[]>();
  for (const choice of choices) {
    const separatorIndex = choice.path.lastIndexOf(" / ");
    const parent =
      separatorIndex === -1 ? "Choices" : choice.path.slice(0, separatorIndex);
    const bucket = groups.get(parent) ?? [];
    bucket.push(choice);
    groups.set(parent, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === "Choices" ? -1 : b === "Choices" ? 1 : a.localeCompare(b),
  );
}

function ChoiceItem({ choice }: { choice: ChoiceSummary }) {
  const { push } = useNavigation();

  // Default run: drive the choice interactively, but stay on the list until a
  // prompt actually appears. We pre-poll here and only open the session view
  // once the run raises a prompt; a prompt-less run just reports via a toast.
  async function runInteractive() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Running ${choice.name}...`,
    });
    try {
      const { session } = await startInteractive(choice.id);
      const abort = new AbortController();
      while (true) {
        const event = await pollSession(session, abort.signal);
        if (event.kind === "idle") continue;
        if (event.kind === "prompt") {
          await toast.hide();
          push(
            <InteractiveSessionView
              session={session}
              choiceName={choice.name}
              initialPrompt={{
                requestId: event.requestId,
                prompt: event.prompt,
              }}
            />,
          );
          return;
        }
        if (event.kind === "done") {
          await reportInteractiveDone(toast, choice, event.result);
          return;
        }
        if (event.kind === "error") {
          throw new Error(event.error);
        }
      }
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not run ${choice.name}` });
    }
  }

  async function runInObsidian() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Running ${choice.name} in Obsidian...`,
      message: "Complete the prompts in Obsidian",
    });
    try {
      await open("obsidian://open"); // bring Obsidian forward so prompts are visible
      const result = await runChoice(choice.id, { ui: true });
      await reportRunResult(toast, choice, result);
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not run ${choice.name}` });
    }
  }

  const accessories: List.Item.Accessory[] = [];
  if (choice.command) {
    accessories.push({
      icon: Icon.Bolt,
      tooltip: "Marked as a command in QuickAdd - pin it as a Quicklink",
    });
  }
  accessories.push({ tag: choice.type });

  return (
    <List.Item
      icon={choiceIcon(choice.type)}
      title={choice.name}
      accessories={accessories}
      keywords={choice.path.split(" / ")}
      actions={
        <ActionPanel>
          <Action title="Run" icon={Icon.Play} onAction={runInteractive} />
          <Action
            title="Run in Obsidian"
            icon={Icon.AppWindow}
            onAction={runInObsidian}
          />
          <Action.CreateQuicklink
            title="Pin as Quicklink"
            icon={Icon.Pin}
            quicklink={{ name: choice.name, link: choiceDeeplink(choice.id) }}
          />
          <Action.CopyToClipboard
            title="Copy Deeplink"
            icon={Icon.Link}
            content={choiceDeeplink(choice.id)}
          />
        </ActionPanel>
      }
    />
  );
}

/** Report a prompt-less interactive run's `done` event (we never left the list). */
async function reportInteractiveDone(
  toast: Toast,
  choice: RunnableChoice,
  result: unknown,
) {
  const r = (result ?? {}) as { ok?: boolean; error?: string; file?: string };
  if (r.ok === false) {
    throw new Error(r.error ?? "Choice execution failed");
  }
  toast.style = Toast.Style.Success;
  toast.title = `Ran ${choice.name}`;
  if (r.file) {
    const file = r.file;
    toast.message = file;
    toast.primaryAction = {
      title: "Open in Obsidian",
      onAction: () => open(obsidianOpenUrl(file)),
    };
  }
}

async function reportRunResult(
  toast: Toast,
  choice: RunnableChoice,
  result: RunResponse,
) {
  if (!result.ok) {
    throw new Error(result.error ?? "Choice execution failed");
  }
  toast.style = Toast.Style.Success;
  toast.title = `Ran ${choice.name}`;
  if (result.file) {
    const file = result.file;
    toast.message = file;
    toast.primaryAction = {
      title: "Open in Obsidian",
      onAction: () => open(obsidianOpenUrl(file)),
    };
  }
  await popToRoot();
}
