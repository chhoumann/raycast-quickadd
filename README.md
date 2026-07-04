# QuickAdd for Obsidian - Raycast extension

Run your [QuickAdd](https://github.com/chhoumann/quickadd) choices, captures, and templates from Raycast. This extension is a thin front end over QuickAdd: it does not reimplement anything, it drives the plugin through the official Obsidian CLI so every workflow you already have in your vault is reachable from Raycast.

## How it works

Obsidian ships a command-line interface (Settings → General → Command line interface). QuickAdd registers handlers on it (`quickadd:list`, `quickadd:check`, `quickadd:run`, `quickadd:run-template`). The extension shells out to that CLI and parses the JSON it returns:

1. **List** enumerates your choices (grouped by their Multi folders).
2. **Check** preflights a choice and reports which inputs it needs, with full field metadata (dropdown options, dates, numeric ranges, file pickers).
3. The extension renders those inputs as a native Raycast form.
4. **Run** executes the choice with your answers pre-seeded, so no Obsidian modal appears. The created/updated file path comes back for a one-keystroke "Open in Obsidian".

Choices that need a genuinely interactive picker mid-run (heading choosers, multi-file pickers) can be launched with **Run Interactively in Obsidian**, which lets QuickAdd prompt inside Obsidian instead.

## Commands

- **Run QuickAdd Choice** - browse every runnable choice, fill its inputs, run it. Choices that Obsidian flags as commands are marked, and any choice can be **pinned as a Quicklink** (⌘K → Pin as Quicklink) so it becomes root-searchable and hotkey-able in Raycast.
- **Quick Capture** - a no-view command that sends its text argument to a capture choice of your choosing (set per-command in preferences). Bind it to a hotkey for frictionless capture.

### Multi-line input, driven by the vault

The form renders each input from the choice's own requirement metadata. To get a large, dictation-friendly text area, declare the value as multi-line in QuickAdd itself - `{{VALUE:label|type:multiline}}`, or a macro user script whose `quickadd.inputs` entry uses `type: "textarea"`. The extension renders whatever the vault describes; there is no bespoke "big field" command to maintain.

## Requirements

- **QuickAdd >= 2.14.** Earlier versions expose the CLI but not the richer field metadata or verified run outcomes, so option fields fall back to plain text and some captures can report success without writing. Update QuickAdd for full fidelity.
- **Obsidian with the CLI enabled**, and the target vault open (the CLI talks to the running app).

## Preferences

- **Vault Name** - the vault QuickAdd runs against (as shown in Obsidian's vault switcher).
- **Obsidian CLI Path** - optional; auto-detected at `/opt/homebrew/bin/obsidian`, `/usr/local/bin/obsidian`, or inside `Obsidian.app`.
- **Quick Capture → Capture Choice** - the capture choice text is sent to. Pick one that works headlessly (a capture whose target file/heading exists, or that creates them).

## Development

```bash
pnpm install
pnpm dev      # ray develop - installs into Raycast in watch mode
pnpm build
pnpm lint
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the extension talks to QuickAdd and why.
