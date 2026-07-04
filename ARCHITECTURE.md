# Architecture

This extension is a thin front end over [QuickAdd](https://github.com/chhoumann/quickadd). It does not reimplement any QuickAdd behavior; it drives the plugin through the official Obsidian CLI and renders the results as native Raycast UI.

## Transport: the Obsidian CLI

Obsidian ships a command-line interface (Settings → General → Command line interface). QuickAdd registers handlers on it, so anything you can trigger in the plugin is reachable from a subprocess that returns JSON:

- `quickadd:list [type=...] [commands]` - the flattened choice tree: `id`, `name`, `type`, `path` (`Multi / child`), `command`, `runnable` (a Multi is a folder, not runnable).
- `quickadd:check choice=<name>|id=<id> [vars=<json>] [fields]` - preflight. Runs QuickAdd's requirement collector and reports the inputs a choice still needs as `missing[]`. Read-only. With `fields`, each entry carries full widget metadata (options, dates, numeric ranges, file pickers) instead of just a count.
- `quickadd:run choice=<name>|id=<id> [vars=<json>] [ui] [verify]` - executes a choice. Values are pre-seeded through `vars`, so no Obsidian modal appears. `ui` re-enables interactive prompts inside Obsidian; `verify` returns the created file path and an honest success/failure for Template and Capture choices.
- `quickadd:run-template path=<vault-path> value-value=<name>` - ad-hoc template execution.

The extension shells out with `execFile` (each argument is a separate argv entry, so no shell quoting is needed for values with spaces or newlines) and parses the JSON envelope.

### Why the CLI, not something else

- **`obsidian://quickadd` URIs** are one-way, have no list/check, and restrict callback schemes - no good for a form-driven UI.
- **Community REST-API plugins** add a third-party dependency and a running server.
- **A custom socket server in the plugin** is heavier than needed when a first-party CLI already exists.

The CLI is two-way, first-party, and already shipped.

## Client contract

A few CLI behaviors the client (`src/lib/obsidianCli.ts`) normalizes:

- The CLI exits `0` on plugin-level errors and prints `{ok:false, error}` on stdout; it exits non-zero on aborted runs but still prints that JSON envelope. Transport failures (`Vault not found.`, Obsidian not running) are plain text. The client parses JSON from both the success and failure paths and only throws for genuine transport errors.
- Choice enumeration goes through `quickadd:list`, never by reading `data.json`. The plugin owns flattening and runnability; duplicating that in the client would break on schema changes.

## Per-choice flow: check → form → run

1. `quickadd:list` populates the searchable command list, grouped by Multi folder.
2. Selecting a choice runs `quickadd:check --fields` to discover its inputs.
3. Each requirement maps to a native Raycast form control (text, textarea, dropdown, date, tag-picker for multi-select, optional custom-input field for suggesters).
4. Submitting runs `quickadd:run` with the answers pre-seeded. The result reports the created file for a one-keystroke "Open in Obsidian".

Requirements that need a genuinely interactive picker mid-run (heading choosers, multi-file pickers, marked `runtimeOnly`) fall back to **Run Interactively in Obsidian**, which passes `ui` so QuickAdd prompts inside the app.

Form item ids are positional (`field-0`), not requirement ids, because QuickAdd requirement ids can contain characters (e.g. a unit-separator in anonymous option-list ids) that make poor form identifiers. The submit handler maps them back and passes everything through `vars` JSON so values with any characters round-trip intact.

## Version requirement

The `fields` and `verify` flags require **QuickAdd >= 2.14**. Older versions expose the CLI but ignore those flags: option fields fall back to plain text, and some captures can report success without writing (the exact bug `verify` surfaces). Update QuickAdd for full fidelity.
