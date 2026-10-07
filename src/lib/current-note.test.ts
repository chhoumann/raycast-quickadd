import { describe, expect, it } from "vitest";
import { headlessCurrentNote, noteItems } from "./current-note";

describe("noteItems", () => {
  it("keeps each note once and drops aliases and attachments", () => {
    const links = [
      { text: "Ada Lovelace", path: "People/Ada Lovelace.md" },
      { text: "Ada", path: "People/Ada Lovelace.md", alias: "Ada" },
      { text: "diagram.png", path: "Assets/diagram.png" },
      { text: "Board.canvas", path: "Board.canvas" },
      { text: "Plan", path: "Plan.md" },
    ];
    expect(noteItems(links).map((item) => item.path)).toEqual([
      "People/Ada Lovelace.md",
      "Plan.md",
    ]);
  });
});

describe("headlessCurrentNote", () => {
  it("refuses a choice that needs a current note", () => {
    expect(() =>
      headlessCurrentNote({ name: "Log to note", currentNote: "required" }),
    ).toThrow(
      /^Log to note needs a current note\. Run it from Run QuickAdd Choice\.$/,
    );
  });

  it("runs a choice that can do without one with no current note", () => {
    expect(
      headlessCurrentNote({ name: "Inbox", currentNote: "optional" }),
    ).toBe("none");
  });

  it("leaves the run alone when the choice does not use the current note", () => {
    expect(headlessCurrentNote({ name: "Inbox", currentNote: "none" })).toBe(
      undefined,
    );
    expect(headlessCurrentNote({ name: "Inbox" })).toBe(undefined);
  });
});
