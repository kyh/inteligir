import { describe, expect, it } from "vitest";

import { refusedBy, standingAfter } from "./note-standing";
import type { NoteStanding, NoteWrite, StandingEvent } from "./note-standing";

const after = (standing: NoteStanding, events: readonly StandingEvent[]): NoteStanding => {
  let now = standing;
  for (const event of events) {
    now = standingAfter(now, event);
  }
  return now;
};

describe("what a note takes", () => {
  it("turns full and takes edits again once a compaction makes room", () => {
    expect(after("open", ["filled"])).toBe("full");
    expect(after("open", ["filled", "shrank"])).toBe("open");
    expect(after("open", ["shrank"])).toBe("open");
  });

  it("stays gone whatever comes after", () => {
    expect(after("open", ["gone"])).toBe("gone");
    expect(after("full", ["gone"])).toBe("gone");
    expect(after("gone", ["shrank", "filled"])).toBe("gone");
  });

  it("refuses each write by the standing that holds it, and no other", () => {
    const writes: readonly NoteWrite[] = ["edit", "article", "undo"];
    const standings: readonly NoteStanding[] = ["open", "full", "gone"];
    const table = standings.map((standing) => writes.map((write) => refusedBy(standing, write)));
    expect(table).toStrictEqual([
      [null, null, null],
      ["full", null, null],
      ["gone", "gone", "gone"],
    ]);
  });
});
