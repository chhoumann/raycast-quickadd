# Architecture

This extension is a thin front end over [QuickAdd](https://github.com/chhoumann/quickadd). It does not reimplement any QuickAdd behavior; it drives the plugin through the official Obsidian CLI and renders the results as native Raycast UI.

## Transport: the Obsidian CLI

Obsidian ships a command-line interface (Settings → General → Command line interface). QuickAdd registers handlers on it, so anything you can trigger in the plugin is reachable from a subprocess that returns JSON:

- `quickadd:list [type=...] [commands]` - the flattened choice tree: `id`, `name`, `type`, `path` (`Multi / child`), `command`, `runnable` (a Multi is a folder, not runnable).
- `quickadd:interactive id=<id> [vars=<json>]` - starts a choice and returns at once with the choice (`id`, `name`, `type`) and the address of a local prompt server (`host`, `port`, `sessionId`, `token`). QuickAdd then sends each prompt to that server instead of opening a modal.
- `quickadd:run choice=<name>|id=<id> [vars=<json>] [ui] [verify]` - runs a choice to completion. **Run in Obsidian** passes `ui` so QuickAdd prompts inside the app. Quick Capture passes its text through `vars`. `verify` returns the created file path and an honest success or failure for Template and Capture choices.

The extension shells out with `execFile` (each argument is a separate argv entry, so no shell quoting is needed for values with spaces or newlines) and parses the JSON envelope.

### Why the CLI, not something else

- **`obsidian://quickadd` URIs** are one-way, cannot list choices, and restrict callback schemes, so Raycast could never answer a prompt through them.
- **Community REST-API plugins** add a third-party dependency and a running server.
- **A custom socket server in the plugin** is heavier than needed when a first-party CLI already exists.

The CLI is two-way, first-party, and already shipped.

## Client contract

A few CLI behaviors the client (`src/lib/obsidianCli.ts`) normalizes:

- The CLI exits `0` on plugin-level errors and prints `{ok:false, error}` on stdout; it exits non-zero on aborted runs but still prints that JSON envelope. Transport failures (`Vault not found.`, Obsidian not running) are plain text. The client parses JSON from both the success and failure paths and only throws for genuine transport errors.
- Choice enumeration goes through `quickadd:list`, never by reading `data.json`. The plugin owns flattening and runnability; duplicating that in the client would break on schema changes.

## Per-choice flow: one interactive run

1. `quickadd:list` fills the searchable list, grouped by Multi folder.
2. **Run** calls `quickadd:interactive` for the selected choice.
3. The extension long-polls the prompt server's `/poll`. Each event is a `prompt`, `done`, `error`, or an `idle` keepalive. The list stays on screen until the first prompt arrives, so a choice without prompts finishes with just a toast.
4. Each prompt renders as a native control, and the answer goes back through `/reply`. QuickAdd collects a choice's declared inputs first, as one `form` prompt. Prompts that a macro script raises later arrive one at a time.
5. The `done` event names the created file for **Open in Obsidian**.

Polling continues while a prompt is open. The poll is the server's only sign that Raycast is still there, so it can tell a slow user from a client that went away.

## One renderer for every form

`src/lib/fields.ts` parses each wire field into a `FieldSpec`: text, number, date, select, or multi. The wire type is `FormField` in `src/lib/interactive.ts`, which mirrors QuickAdd's `src/interactive/promptProtocol.ts`. The `input`, `date`, and `multiselect` prompts become one-field specs, so every form goes through `FieldControl` in `src/form-field.tsx`. On submit, `readField` turns each field's Raycast value into the reply value, or into an error shown on the field.

- A date field gets a time picker when its `dateFormat` has hour, minute, or second tokens outside `[...]` literals.
- A number field rejects text that is not a number and values outside `numericConfig`'s `min` and `max`.
- A select or multi field with `allowCustomInput` gets a text field for values outside the list. For multi, the text field takes comma-separated values.
- As in QuickAdd's one-page form, a single-note picker (`picker: "file"`) starts with no note picked, and the form won't submit until a required one has a pick.

The suggester, confirm, checkbox, and info prompts keep their own views. A suggester is a searchable list, which suits a single pick from many items.

Form item ids are positional (`field-0`), not field ids, because QuickAdd field ids can contain characters that stop Raycast from submitting the form. The reply maps them back to field ids.

## Version requirement

**Run** needs **QuickAdd >= 2.17.2**. `quickadd:interactive` exists from 2.16, and from 2.17.2 it collects a choice's declared inputs as one form even when QuickAdd's one-page input setting is off. Before that, the inputs arrive one prompt at a time.

The `verify` flag that **Run in Obsidian** and Quick Capture pass needs **QuickAdd >= 2.14**. Older versions ignore it, and some captures can report success without writing.

In the one-page form, note pickers start empty only with **QuickAdd >= 2.31**, which marks them with `picker: "file"`. Older versions send them as plain suggesters, so they keep the first note picked.
