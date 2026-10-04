import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type FieldSpec,
  fieldSpecFromForm,
  fieldSpecFromPrompt,
  readField,
} from "../src/lib/fields.ts";
import type { PromptSpec, SessionEvent } from "../src/lib/interactive.ts";

const VAULT = "e2e-vault";
const VAULT_DIR = new URL("../e2e-vault/", import.meta.url);
const CLI = process.env.OBSIDIAN_CLI ?? "/opt/homebrew/bin/obsidian";
const PICKED_DATE = new Date(2026, 9, 5, 14, 30);

function obsidian(...args: string[]): string {
  return execFileSync(CLI, [`vault=${VAULT}`, ...args], { encoding: "utf8" });
}

function userInput(spec: FieldSpec): { raw: unknown; custom?: string } {
  switch (spec.kind) {
    case "text":
      return { raw: `${spec.label} answer` };
    case "number":
      return { raw: "3" };
    case "date":
      return { raw: PICKED_DATE };
    case "select":
      if (spec.notePicker) {
        const target =
          spec.options.find((o) => o.value === "Output/Picked.md") ??
          spec.options.find((o) => o.value.startsWith("People/"));
        return { raw: target?.value ?? "" };
      }
      return {
        raw: spec.options[1].value,
        custom: spec.allowCustom ? "typed" : undefined,
      };
    case "multi":
      return {
        raw: [spec.options[0].value, spec.options[2]?.value].filter(Boolean),
        custom: spec.allowCustom ? "extra, more" : undefined,
      };
  }
}

function answerField(spec: FieldSpec): string | string[] {
  const { raw, custom } = userInput(spec);
  const read = readField(spec, raw, custom);
  if (!read.ok) throw new Error(`${spec.label}: ${read.error}`);
  return read.value;
}

function reply(prompt: PromptSpec): unknown {
  switch (prompt.type) {
    case "form":
      return Object.fromEntries(
        prompt.fields.map((field) => {
          const spec = fieldSpecFromForm(field);
          return [spec.id, answerField(spec)];
        }),
      );
    case "input":
    case "date":
    case "multiselect":
      return answerField(fieldSpecFromPrompt(prompt));
    case "suggester":
      return prompt.allowCustomInput ? "typed" : prompt.items[0].value;
    case "checkbox":
      return prompt.items.filter((item) => !item.checked).map((i) => i.value);
    case "confirm":
    case "info":
      return true;
  }
}

async function run(choiceId: string): Promise<{ file?: string }> {
  const start = JSON.parse(obsidian("quickadd:interactive", `id=${choiceId}`));
  if (!start.ok) throw new Error(start.error);
  const base = `http://${start.host}:${start.port}`;
  const auth = `session=${start.sessionId}&token=${start.token}`;
  for (;;) {
    const event = (await (
      await fetch(`${base}/poll?${auth}`)
    ).json()) as SessionEvent;
    if (event.kind === "idle") continue;
    if (event.kind === "error") throw new Error(event.error);
    if (event.kind === "done") return event.result as { file?: string };
    const value = reply(event.prompt);
    console.log(`  ${event.prompt.type} -> ${JSON.stringify(value)}`);
    const res = await fetch(`${base}/reply?${auth}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: event.requestId, value }),
    });
    if (!res.ok) throw new Error(`reply rejected: ${await res.text()}`);
  }
}

function note(path: string): string {
  return readFileSync(new URL(path, VAULT_DIR), "utf8");
}

const cases: Array<[id: string, path: string, expected: string[]]> = [
  ["e2e-text", "Output/Inbox.md", ["- text: Text to capture answer"]],
  ["e2e-select", "Output/Inbox.md", ["- color: green"]],
  ["e2e-multi", "Output/Inbox.md", ["- tags: alpha,gamma"]],
  ["e2e-custom", "Output/Inbox.md", ["- mood: typed"]],
  ["e2e-number", "Output/Inbox.md", ["- rating: 3"]],
  ["e2e-date", "Output/Inbox.md", ["- due: 2026-10-05 14:30"]],
  ["e2e-picker", "Output/Picked.md", ["- picked: Text to capture answer"]],
  [
    "e2e-runtime",
    "Output/Inbox.md",
    ["- runtime: note answer | alpha,gamma | 2026-10-05"],
  ],
  ["e2e-template", "Output/name answer.md", ["Friend: Ada Lovelace"]],
  [
    "e2e-macro",
    "Output/Script output.md",
    [
      '"input": "Title answer"',
      '"wide": "Body answer"',
      '"suggester": "typed"',
      '"checkbox": [\n    "x",\n    "z"\n  ]',
      '"date": "2026-10-05"',
      '"confirm": true',
      '"effort": "3"',
      '"confidence": "3"',
      '"status": "Doing"',
      '"labels": "work, extra, more"',
      '"start": "2026-10-05"',
    ],
  ],
];

obsidian(
  "eval",
  `code=void (async () => {
    const out = app.vault.getAbstractFileByPath("Output");
    if (out) await app.vault.delete(out, true);
    await app.vault.createFolder("Output");
    await app.vault.create("Output/Picked.md", "# Picked\\n");
  })()`,
);
await sleep(1500);

let failed = 0;
for (const [id, path, expected] of cases) {
  console.log(`${id}`);
  try {
    const result = await run(id);
    await sleep(300);
    const content = note(path);
    const missing = expected.filter((text) => !content.includes(text));
    if (missing.length > 0) {
      throw new Error(
        `${path} lacks ${JSON.stringify(missing)}:\n${content.trim()}`,
      );
    }
    console.log(`  ok (${result.file ?? path})`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${error instanceof Error ? error.message : error}`);
  }
}
console.log(
  failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} passed`,
);
process.exit(failed ? 1 : 0);
