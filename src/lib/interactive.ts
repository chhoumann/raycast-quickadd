import { getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ObsidianCliError, resolveCliPath } from "./obsidianCli";
import type { ChoiceRef } from "./types";

const execFileAsync = promisify(execFile);

interface Preferences {
  vault: string;
}

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

export async function startInteractive(
  choiceId: string,
): Promise<{ session: InteractiveSession; choice: ChoiceRef }> {
  const cli = resolveCliPath();
  const { vault } = getPreferenceValues<Preferences>();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      cli,
      [`vault=${vault.trim()}`, "quickadd:interactive", `id=${choiceId}`],
      {
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    ));
  } catch (error) {
    const failed =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout: unknown }).stdout).trim()
        : "";
    if (failed) stdout = failed;
    else
      throw new ObsidianCliError(
        `Could not start interactive run: ${error instanceof Error ? error.message : String(error)}`,
      );
  }

  let parsed: {
    ok?: boolean;
    error?: string;
    host?: string;
    port?: number;
    sessionId?: string;
    token?: string;
    choice?: ChoiceRef;
  };
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new ObsidianCliError(
      stdout.trim() || "Obsidian returned no output. Is the vault open?",
    );
  }
  if (
    !parsed.ok ||
    !parsed.port ||
    !parsed.sessionId ||
    !parsed.token ||
    !parsed.choice
  ) {
    throw new ObsidianCliError(
      parsed.error ??
        "Interactive run could not be started (needs QuickAdd with the interactive bridge).",
    );
  }
  return {
    session: {
      host: parsed.host ?? "127.0.0.1",
      port: parsed.port,
      sessionId: parsed.sessionId,
      token: parsed.token,
    },
    choice: parsed.choice,
  };
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
