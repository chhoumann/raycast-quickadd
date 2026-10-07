import type { LinkItem } from "./suggest";
import type { CurrentNoteUse } from "./types";

/** The run's current note: a vault path, or "none" for no current note. */
export type CurrentNote = string;

interface UsesCurrentNote {
  name: string;
  currentNote?: CurrentNoteUse;
}

/** Without an explicit note, QuickAdd would use whatever tab Obsidian has open. */
export function asksForCurrentNote(choice: UsesCurrentNote): boolean {
  return choice.currentNote === "optional" || choice.currentNote === "required";
}

/** The notes a run can take as its current note: no aliases, no attachments. */
export function noteItems(links: LinkItem[]): LinkItem[] {
  return links.filter((item) => !item.alias && item.path.endsWith(".md"));
}

/** The current note for a run with no one to ask, as the capture commands are. */
export function headlessCurrentNote(
  choice: UsesCurrentNote,
): CurrentNote | undefined {
  if (choice.currentNote === "required") {
    throw new Error(
      `${choice.name} needs a current note. Run it from Run QuickAdd Choice.`,
    );
  }
  return choice.currentNote === "optional" ? "none" : undefined;
}
