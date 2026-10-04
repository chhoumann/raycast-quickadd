import {
  Action,
  ActionPanel,
  Form,
  Icon,
  type LaunchProps,
  List,
  Toast,
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
  useCachedState,
  useFrecencySorting,
} from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import {
  listChoices,
  obsidianOpenUrl,
  runChoice,
  startInteractive,
} from "./lib/obsidianCli";
import { choiceIcon } from "./lib/format";
import { STALL_MS, InteractiveSessionView } from "./interactive-session";
import {
  type DoneResult,
  type InteractiveSession,
  doneMessage,
  firstEvent,
} from "./lib/interactive";
import type { ChoiceSummary } from "./lib/types";

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
  // The hook sorts in place and cannot tell visited items from the rest, so it
  // gets a copy and the visited ids are kept beside it.
  const { data: byFrecency, visitItem } = useFrecencySorting(data && [...data]);
  const [visited, setVisited] = useCachedState<string[]>("visited-choices", []);
  const visit = (choice: ChoiceSummary) => {
    void visitItem(choice);
    setVisited((ids) => (ids.includes(choice.id) ? ids : [...ids, choice.id]));
  };

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

  const recent = byFrecency
    .filter((choice) => visited.includes(choice.id))
    .slice(0, 5);
  const sections = groupByParent(data ?? []);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search QuickAdd choices..."
    >
      <List.Section title="Recent">
        {recent.map((choice) => (
          <ChoiceItem
            key={`recent-${choice.id}`}
            choice={choice}
            onRun={visit}
          />
        ))}
      </List.Section>
      {sections.map(([parent, choices]) => (
        <List.Section key={parent} title={parent}>
          {choices.map((choice) => (
            <ChoiceItem key={choice.id} choice={choice} onRun={visit} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

/**
 * Opens one choice directly (used when launched from a pinned Quicklink). The
 * session view shows the run from the start and closes the window with a HUD.
 */
function DirectChoice({ choiceId }: { choiceId: string }) {
  const [view, setView] = useState<
    | { phase: "loading" }
    | { phase: "attach"; session: InteractiveSession; choiceName: string }
    | { phase: "error"; message: string }
  >({ phase: "loading" });
  // Raycast double-invokes effects (StrictMode); without the ref the choice
  // runs twice.
  const startRef = useRef<ReturnType<typeof startInteractive> | null>(null);

  useEffect(() => {
    let cancelled = false;
    startRef.current ??= startInteractive(choiceId);
    startRef.current.then(
      ({ session, choice }) => {
        if (!cancelled)
          setView({ phase: "attach", session, choiceName: choice.name });
      },
      (error) => {
        if (cancelled) return;
        setView({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        void showFailureToast(error, { title: "Could not run choice" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [choiceId]);

  if (view.phase === "attach") {
    const { choiceName } = view;
    return (
      <InteractiveSessionView
        session={view.session}
        choiceName={choiceName}
        onEnd={(end) =>
          void showHUD(
            end.state === "done"
              ? doneMessage(choiceName, end.result)
              : "Cancelled",
          )
        }
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

function ChoiceItem({
  choice,
  onRun,
}: {
  choice: ChoiceSummary;
  onRun: (choice: ChoiceSummary) => void;
}) {
  const { push, pop } = useNavigation();

  async function runInteractive() {
    onRun(choice);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Running ${choice.name}...`,
    });
    try {
      const { session } = await startInteractive(choice.id);
      const first = await firstEvent(session, STALL_MS);
      if (first.kind === "error") throw new Error(first.error);
      await toast.hide();
      if (first.kind === "done") {
        await showToast(doneToast(choice.name, first.result));
        return;
      }
      push(
        <InteractiveSessionView
          session={session}
          choiceName={choice.name}
          handoff={first}
          onEnd={(end) => {
            pop();
            void showToast(
              end.state === "done"
                ? doneToast(choice.name, end.result)
                : { style: Toast.Style.Success, title: "Cancelled" },
            );
          }}
        />,
      );
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not run ${choice.name}` });
    }
  }

  async function runInObsidian() {
    onRun(choice);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Running ${choice.name} in Obsidian...`,
      message: "Complete the prompts in Obsidian",
    });
    try {
      await open("obsidian://open"); // bring Obsidian forward so prompts are visible
      const result = await runChoice(choice.id, { ui: true });
      if (!result.ok) {
        throw new Error(result.error ?? "Choice execution failed");
      }
      await toast.hide();
      await showToast(doneToast(choice.name, result));
      await popToRoot();
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

function doneToast(choiceName: string, result: DoneResult): Toast.Options {
  const { file } = result;
  return {
    style: Toast.Style.Success,
    title: doneMessage(choiceName, result),
    primaryAction: file
      ? {
          title: "Open in Obsidian",
          onAction: () => open(obsidianOpenUrl(file)),
        }
      : undefined,
  };
}
