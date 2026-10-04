import type { ChoiceEffect } from "./types";

export interface SuggesterItem {
  title: string;
  value: string;
}

export interface CheckboxItem {
  title: string;
  value: string;
  checked: boolean;
}

export interface FormField {
  id: string;
  label: string;
  type:
    | "text"
    | "number"
    | "textarea"
    | "dropdown"
    | "date"
    | "suggester"
    | "slider"
    | "field-suggest";
  placeholder?: string;
  defaultValue?: string;
  description?: string;
  options?: string[];
  /** Labels shown for `options` (e.g. note names for note paths). */
  displayOptions?: string[];
  dateFormat?: string;
  optional?: boolean;
  numericConfig?: { min?: number; max?: number; step?: number };
  suggesterConfig?: { allowCustomInput?: boolean; multiSelect?: boolean };
  /** `"file"` on a suggester that picks notes. Sent by QuickAdd 2.31.0+. */
  picker?: "file";
}

type KnownPrompt =
  | {
      type: "suggester";
      placeholder?: string;
      allowCustomInput: boolean;
      items: SuggesterItem[];
    }
  | {
      type: "multiselect";
      placeholder?: string;
      allowCustomInput: boolean;
      items: SuggesterItem[];
      preselected: string[];
    }
  | {
      type: "input";
      header: string;
      placeholder?: string;
      defaultValue?: string;
      multiline: boolean;
    }
  | {
      type: "date";
      header: string;
      placeholder?: string;
      defaultValue?: string;
      dateFormat?: string;
      withTime?: boolean;
    }
  | { type: "confirm"; header: string; text?: string }
  | { type: "checkbox"; header?: string; items: CheckboxItem[] }
  | { type: "info"; header: string; text: string[] }
  | { type: "form"; fields: FormField[] };

/** `unknown` stands for a prompt type added by a newer QuickAdd. */
export type PromptSpec = KnownPrompt | { type: "unknown"; wireType: string };

const KNOWN_PROMPT_TYPES: Record<KnownPrompt["type"], true> = {
  suggester: true,
  multiselect: true,
  input: true,
  date: true,
  confirm: true,
  checkbox: true,
  info: true,
  form: true,
};

type WirePrompt = KnownPrompt | { type: string };

function isKnownPrompt(prompt: WirePrompt): prompt is KnownPrompt {
  return Object.hasOwn(KNOWN_PROMPT_TYPES, prompt.type);
}

export type ReplyValue =
  string | string[] | boolean | Record<string, string | string[]>;

export interface DoneResult {
  effect?: ChoiceEffect;
  /** Vault-relative path of the file the run created or changed. */
  file?: string;
}

export type SessionEvent =
  | { kind: "prompt"; requestId: string; prompt: PromptSpec }
  | { kind: "done"; result: DoneResult }
  | { kind: "error"; error: string }
  | { kind: "idle" };

type RunEvent = Exclude<SessionEvent, { kind: "idle" }>;

/** The poll response as QuickAdd sends it: its prompt types are an open set. */
type WireEvent =
  | Exclude<SessionEvent, { kind: "prompt" }>
  | { kind: "prompt"; requestId: string; prompt: WirePrompt };

export interface InteractiveSession {
  host: string;
  port: number;
  sessionId: string;
  token: string;
}

export interface PendingPrompt {
  requestId: string;
  prompt: PromptSpec;
}

/** Where one run stands. `cancelled` is reached only through the user's cancel. */
export type SessionState =
  | { state: "connecting" }
  | { state: "prompt"; pending: PendingPrompt }
  | { state: "working" }
  | { state: "done"; result: DoneResult }
  | { state: "failed"; message: string }
  | { state: "cancelled" };

export type SessionEnd = Extract<SessionState, { state: "done" | "cancelled" }>;

export interface SessionDriver {
  answer(value: ReplyValue): void;
  /** The user's cancel: stops the run in Obsidian and moves to `cancelled`. */
  cancel(): void;
  /** Stops the run in Obsidian if it is still live, without reporting a state. */
  dispose(): void;
}

export function doneMessage(
  choiceName: string,
  { effect, file }: DoneResult,
): string {
  if (file && effect === "created") return `Created ${file}`;
  if (file && effect === "changed") return `Added to ${file}`;
  return `Ran ${choiceName}`;
}

function url(s: InteractiveSession, path: string): string {
  return `http://${s.host}:${s.port}${path}?session=${encodeURIComponent(s.sessionId)}&token=${encodeURIComponent(s.token)}`;
}

/** Long-poll until the run raises a prompt or ends, skipping idle keepalives. */
export async function nextEvent(
  s: InteractiveSession,
  signal?: AbortSignal,
): Promise<RunEvent> {
  for (;;) {
    const res = await fetch(url(s, "/poll"), { signal });
    if (!res.ok) {
      throw new Error(
        `Interactive session poll failed (${res.status}). The run may have ended.`,
      );
    }
    const event = (await res.json()) as WireEvent;
    if (event.kind === "idle") continue;
    if (event.kind !== "prompt") return event;
    const { requestId, prompt } = event;
    return {
      kind: "prompt",
      requestId,
      prompt: isKnownPrompt(prompt)
        ? prompt
        : { type: "unknown", wireType: prompt.type },
    };
  }
}

async function replyToPrompt(
  s: InteractiveSession,
  requestId: string,
  value: ReplyValue,
): Promise<void> {
  await fetch(url(s, "/reply"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, value }),
  });
}

/**
 * Rejects every open prompt and any the run raises later (QuickAdd >= 2.20). A run
 * that is mid-work stops at its next prompt.
 */
async function abortSession(s: InteractiveSession): Promise<void> {
  await fetch(url(s, "/abort"), { method: "POST" });
}

/**
 * Polls the run and tracks its state until it ends. Polling continues while a
 * prompt is open: it is the server's only sign that the client is still there.
 */
export function driveSession(
  session: InteractiveSession,
  {
    initial,
    onChange,
  }: { initial: SessionState; onChange: (state: SessionState) => void },
): SessionDriver {
  let current = initial;
  const polls = new AbortController();
  const isLive = () =>
    current.state === "connecting" ||
    current.state === "prompt" ||
    current.state === "working";
  const enter = (next: SessionState) => {
    if (!isLive()) return;
    current = next;
    onChange(next);
  };
  const fail = (error: unknown) =>
    enter({
      state: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  const stop = (report: boolean) => {
    if (!isLive()) return;
    current = { state: "cancelled" };
    if (report) onChange(current);
    polls.abort();
    void abortSession(session).catch(() => {});
  };

  void (async () => {
    while (isLive()) {
      const event = await nextEvent(session, polls.signal);
      if (event.kind === "prompt") {
        const { requestId, prompt } = event;
        enter({ state: "prompt", pending: { requestId, prompt } });
      } else if (event.kind === "done") {
        enter({ state: "done", result: event.result });
      } else {
        enter({ state: "failed", message: event.error });
      }
    }
  })().catch(fail);

  return {
    answer(value) {
      if (current.state !== "prompt") return;
      const { requestId } = current.pending;
      enter({ state: "working" });
      replyToPrompt(session, requestId, value).catch(fail);
    },
    cancel: () => stop(true),
    dispose: () => stop(false),
  };
}
