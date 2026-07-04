# Raycast x QuickAdd integration - implementation notes

Goal: Raycast extension as a full front end for QuickAdd. Anything you can do in QuickAdd should be reachable through Raycast. Raycast does not replace the plugin; it communicates with it. Plugin changes are allowed but must be light and generic (useful beyond Raycast).

## Environment facts (2026-07-04)

- Plugin repo: `~/Developer/quickadd`, v2.14.0 (dev), pnpm, Svelte, vitest (+ e2e config).
- Vault: `~/notes`, installed QuickAdd v2.13.1, `devMode: true`.
- Vault config: ~80 choices (Capture/Template/Macro/Multi), a `workflows` map (new engine, steps reference choices by name), `globalVariables`, `enableUriCallbacks: false`, `onePageInputEnabled: false`.
- No Local REST API plugin and no Advanced URI plugin installed in the vault.
- `~/Developer/raycast-quickadd` was empty - greenfield Raycast extension.

## Key finding: QuickAdd already has a CLI surface

QuickAdd registers handlers against the official Obsidian CLI (`registerCliHandler`, Obsidian 1.13+; binary ships inside Obsidian.app, symlinked at `/opt/homebrew/bin/obsidian`). Source: `src/cli/registerQuickAddCliHandlers.ts`.

Commands (all return a JSON envelope `{ok, command, ...}` on stdout):

- `quickadd:list [type=...] [commands]` - flattened choice tree with id, name, type, `path` ("Multi / child"), `command`, `runnable` (Multi = not runnable).
- `quickadd:check choice=<name>|id=<id> [vars=<json>] [value-<var>=...]` - preflight: runs `collectChoiceRequirements`, reports unresolved inputs as `missing[]` (+ `missingFlags`). Read-only.
- `quickadd:run` / `quickadd` - executes a choice. Vars via `vars=<json>` or `value-<name>=<v>` or bare `<name>=<v>`. Non-interactive by default: pre-seeds executor variables, aborts with a clear error instead of hanging on un-satisfiable modals. `ui` flag re-enables prompting in Obsidian. Returns `verified:false` on the legacy path (engines can swallow failures).
- `quickadd:run-template path=<vault-path> value-value=<name>` - ad-hoc template execution with verified outcome (`file`, `verified:true`).
- `quickadd:package-preview` - package inspection.

Verified working end-to-end against the live vault (installed 2.13.1 already serves all of these; 91 choices listed).

CLI behavior notes for the client:
- Exit code is always 0, even on errors. Transport-level errors ("Vault not found.") are plain text, plugin-level errors are JSON `{ok:false,error}`. Client must handle both.
- `value-__qa.captureTargetFilePath` is the documented way to pick a capture target non-interactively for folder/tag/property-scoped captures.
- Capture-to-active-file and `{{SELECTED}}` semantics in a headless run need verification (no active editor context).

There is also an `obsidian://quickadd` x-callback-url layer (`src/uri/uriCallback.ts`, gated by `enableUriCallbacks`, currently off in the vault). One-way fallback; the CLI supersedes it for our purposes.

## Requirement metadata gap (light plugin change)

`RequirementCollector` (src/preflight/RequirementCollector.ts) produces rich `FieldRequirement`s: types `text|number|textarea|dropdown|slider|date|field-suggest|file-picker|suggester`, `options` + `displayOptions` (incl. `@file:<path>`-encoded file pickers), `defaultValue`, `numericConfig`, `sliderConfig`, `dateFormat`/`withTime`, `suggesterConfig`, `optional`, `runtimeOnly`. But the CLI's `toMissingFieldSummary` reduces that to `optionCount`. A Raycast form needs the real options/config. Plan: opt-in `fields` flag on `quickadd:check` returning full requirement objects. Generic (any external front end benefits), light, testable.

## Decisions

1. **Transport: official Obsidian CLI -> QuickAdd CLI handlers.** Two-way JSON, already shipped, first-party, no new daemon/server, no URI round-trip hacks. Alternatives considered: `obsidian://quickadd` URIs (one-way, no list/check, callback schemes limited to shortcuts:/obsidian:), Local REST API community plugin (not installed, third-party dep), custom socket server in plugin (heavier than needed given the CLI exists).
2. **Choice enumeration via `quickadd:list`, not by reading data.json directly.** The plugin owns flattening/runnability semantics; reading vault files would duplicate them and break on schema changes. data.json parsing stays a non-goal.
3. **Raycast flow per choice: check -> form -> run.** Non-interactive by default; anything `runtimeOnly`/unsatisfiable falls back to "Run in Obsidian" (ui flag) as an explicit action.

## Second plugin change: `verify` flag on quickadd:run (implemented, uncommitted)

While E2E testing I found `quickadd:run` reports `ok:true` on the legacy void-execute path even when the Capture/Template engine silently no-ops (e.g. on QuickAdd 2.13.1 the "Test" capture returns `ok:true, durationMs:2` and writes nothing). `run-template` already used the verified-outcome path; `quickadd:run` did not. Added an opt-in `verify` flag that routes Template/Capture through `executeWithOutcome`, returning the real `file` path on success and an honest error on failure. Default (no flag) keeps the legacy envelope for backward compat. Test + graceful-degradation verified.

## Version requirement (important)

The extension targets **QuickAdd >= 2.14** (currently unreleased; it's `~/Developer/quickadd` master + my two flags). Against 2.13.1 it still runs but with reduced fidelity:
- `quickadd:check fields` is ignored → no dropdown options / widget config, so option fields render as plain text.
- `quickadd:run verify` is ignored → captures can silently no-op while reporting success (the exact bug the flag fixes).
- The `fields`/`verify` flags leak as inert variables (`fields`/`verify`) into the executor on old versions - harmless unless a choice literally references `{{VALUE:fields}}`.

Action for full fidelity: release QuickAdd 2.14 (with the two flags) so it reaches the `notes` vault normally. The `notes` vault was restored to its shipped 2.13.1 after testing (backup at `.obsidian/plugins/quickadd/backup/2.13.1-pre-raycast-integration/`).

## E2E evidence (Raycast Beta, live `notes` vault on the 2.14-dev build)

- Extension registered via `ray develop` under author `christian` (the invalid `chhoumann` handle silently blocked dev registration - Raycast validates the author against its API). The dev channel is Raycast Beta (`raycast-x://`), not stable Raycast.
- Run QuickAdd Choice: list rendered pixel-perfect (type icons, emoji names, Capture/Macro/Template tags, grouped by Multi path, Run/Actions footer). Selecting "Test" → check → dynamic form ("Enter value") → typed a value → Run → QuickAdd wrote the timestamped line to `workbench8.md`, result `verified:true, file:workbench8.md`. Full round trip confirmed.
- Quick Capture (no-view, with argument + per-command capture-choice preference): extension invoked the CLI with the right choice and text, relayed the exact JSON envelope back, and surfaced the engine's abort reason faithfully ("Insert-after target not found: '### Thoughts'" - a vault-state issue, not an integration bug).
- Transport-error handling: aborted runs (CLI exits nonzero but prints the JSON envelope on stdout) are parsed from the failed-exec stdout instead of throwing a generic error.

## UX finding (not yet actioned)

Quick Capture's default capture choice ("💭 Add a Thought") aborts unless today's daily note already has its "### Thoughts" heading. Fine as a personal default, but worth either picking a more robust default or documenting it. Left as-is; noted in README.

## Open questions

- [ ] Full URI callback schema + what `enableUriCallbacks` gates (explorer running).
- [ ] Which prompts can still appear mid-run even with vars pre-seeded (macros with requestInput scripts?) - explorer running.
- [ ] Workflows engine: externally triggerable? Worth a Raycast command?
- [ ] Behavior when Obsidian is not running (does the CLI launch it or fail?) - test during E2E.
- [ ] `quickadd:run` could adopt the verified-outcome path for Template/Capture like run-template does (possible second light plugin change; check why it was kept legacy).

## Plugin change: `fields` flag on quickadd:check (implemented, uncommitted)

`~/Developer/quickadd`, on master, working tree change (left uncommitted for review):
- `src/cli/registerQuickAddCliHandlers.ts`: new `fields` flag on `quickadd:check` (added to CHECK_FLAGS and RESERVED_CHECK_PARAMS so it can't leak into variables). When set, `missing[]` entries carry the full FieldRequirement: `options`, `displayOptions`, `dateFormat`, `withTime`, `optional`, `runtimeOnly`, `multiEmit`, `numericConfig`, `sliderConfig`, `suggesterConfig` (undefined keys drop out of the JSON). Default envelope unchanged.
- `src/cli/registerQuickAddCliHandlers.test.ts`: regression test (detailed vs. compact, flag not leaking into executor vars).
- Full suite green: 3602 passed / 37 skipped. `pnpm run build` clean.

E2E verified in the dev vault (`vault=dev`): dropdown choice returns `options:["option-a","option-b"]` with `fields`, compact without; VDATE returns `dateFormat`/`withTime`; headless `quickadd:run` with pre-seeded dropdown var appended the capture line to `qa-fresh.md`.

Gotcha found on the way: anonymous option-list variables have ids like `"option-a,option-bPick one"` (US control char between options and label). Any client must pass vars via `vars=<json>`, not `value-<id>=` flags.

Boyscout fix: the dev vault's quickadd plugin symlinks pointed at a deleted Orca worktree (`~/orca/workspaces/quickadd/768-takeover-appendlink-properties/`), so QuickAdd silently failed to load in the dev vault. Repointed main.js/manifest.json/styles.css to `~/Developer/quickadd` per AGENTS.md and reloaded (`obsidian vault=dev reload`).

## Log

- 2026-07-04: Kickoff. Surveyed vault config and repo. Spawned explorations of plugin entry points and the choice execution model.
- 2026-07-04: Found `src/cli/` handlers; verified `quickadd:list`/`quickadd:check` live against the vault via the official Obsidian CLI. Architecture decided: CLI transport.
