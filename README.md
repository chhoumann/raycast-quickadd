# QuickAdd for Obsidian - Raycast extension

Run your [QuickAdd](https://github.com/chhoumann/quickadd) choices, captures, and templates from Raycast. This extension is a thin front end over QuickAdd: it does not reimplement anything, it drives the plugin through the official Obsidian CLI so every workflow you already have in your vault is reachable from Raycast.

## How it works

Obsidian ships a command-line interface (Settings → General → Command line interface). QuickAdd registers handlers on it. The extension shells out to that CLI and parses the JSON it returns.

1. The command lists your choices with `quickadd:list`, grouped by their Multi folders.
2. **Run** starts the choice with `quickadd:interactive`. QuickAdd runs it inside Obsidian and sends each prompt to Raycast instead of opening a modal.
3. The extension renders each prompt as a native Raycast control. A choice's declared inputs arrive together as one form. Prompts from a macro script (`inputPrompt`, `suggester`, `datePrompt`, and the rest) arrive one at a time.
4. When the run finishes, a toast says what it did ("Created <file>" or "Added to <file>") and offers **Open in Obsidian**.

**Run in Obsidian** (⌘K) runs the choice inside Obsidian with QuickAdd's own modals.

## Commands

- **Run QuickAdd Choice** - browse every runnable choice, run it, and answer its prompts in Raycast. Choices that Obsidian flags as commands are marked, and any choice can be **pinned as a Quicklink** (⌘K → Pin as Quicklink) so it becomes root-searchable and hotkey-able in Raycast.
- **Quick Capture** - a no-view command that sends its text argument to a capture choice of your choosing (set per-command in preferences). Bind it to a hotkey for frictionless capture.

### Multi-line input, driven by the vault

The form renders each input from the field metadata QuickAdd sends. To get a large, dictation-friendly text area, declare the value as multi-line in QuickAdd itself - `{{VALUE:label|type:multiline}}`, or a macro user script whose `quickadd.inputs` entry uses `type: "textarea"`. The extension renders whatever the vault describes; there is no bespoke "big field" command to maintain.

## Requirements

- **QuickAdd >= 2.17.2.** From 2.17.2, `quickadd:interactive` collects a choice's declared inputs as one form. Earlier versions ask for them one prompt at a time, or lack `quickadd:interactive` entirely (before 2.16).
- **QuickAdd >= 2.20** for **Cancel Run** to stop the run in Obsidian, and for the "Created" and "Added to" finish messages.
- **QuickAdd >= 2.31** for note pickers that start empty. Older versions keep the first note picked in a note picker.
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
pnpm test     # unit tests for field parsing and validation
```

### Check the prompt replies against a real vault

`e2e-vault/` has one QuickAdd choice per field kind and a macro script that raises every script prompt.

1. Build QuickAdd in `~/Developer/quickadd` (set `QUICKADD_DIR` to use another checkout), then run `scripts/setup-e2e-vault.sh` to copy the plugin into `e2e-vault/`.
2. Open `e2e-vault/` in Obsidian with **Open folder as vault**, and turn on community plugins when Obsidian asks.
3. Run `pnpm e2e:protocol`. The script runs every choice through `quickadd:interactive`, answers each prompt with replies built by `readField`, and checks the notes QuickAdd writes to `e2e-vault/Output/`.

To see the forms in Raycast, set the extension's **Vault Name** to `e2e-vault` and open a choice through its deeplink.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the extension talks to QuickAdd and why.
