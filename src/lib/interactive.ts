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

export type PromptSpec =
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

export type ReplyValue =
  string | string[] | boolean | Record<string, string | string[]> | null;

export type SessionEvent =
  | { kind: "prompt"; requestId: string; prompt: PromptSpec }
  | { kind: "done"; result: unknown }
  | { kind: "error"; error: string }
  | { kind: "idle" };

export interface InteractiveSession {
  host: string;
  port: number;
  sessionId: string;
  token: string;
}

function baseUrl(s: InteractiveSession): string {
  return `http://${s.host}:${s.port}`;
}

function authQuery(s: InteractiveSession): string {
  return `session=${encodeURIComponent(s.sessionId)}&token=${encodeURIComponent(s.token)}`;
}

/** Long-poll for the next session event. Resolves on a prompt, completion, or an idle keepalive. */
export async function pollSession(
  s: InteractiveSession,
  signal?: AbortSignal,
): Promise<SessionEvent> {
  const res = await fetch(`${baseUrl(s)}/poll?${authQuery(s)}`, { signal });
  if (!res.ok) {
    throw new Error(
      `Interactive session poll failed (${res.status}). The run may have ended.`,
    );
  }
  return (await res.json()) as SessionEvent;
}

/** Answer a prompt with its type-appropriate value, or cancel it (aborts the run). */
export async function replyToPrompt(
  s: InteractiveSession,
  requestId: string,
  value: ReplyValue,
  cancelled = false,
): Promise<void> {
  await fetch(`${baseUrl(s)}/reply?${authQuery(s)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      cancelled ? { requestId, cancelled: true } : { requestId, value },
    ),
  });
}
