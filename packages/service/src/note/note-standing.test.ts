import { describe, expect, it } from "vitest";

import { refusedBy, standingAfter, standingColumns, standingOf } from "./note-standing";
import type { NoteStanding, NoteWrite, StandingEvent } from "./note-standing";

type Kept = Exclude<NoteStanding, { kind: "gone" }>;

const OPEN: Kept = { kind: "open" };
const FULL: Kept = { kind: "full" };
const GONE: NoteStanding = { kind: "gone" };
const deletedWith = (full: boolean): Kept => ({ full, kind: "deleted" });

const after = (standing: NoteStanding, events: readonly StandingEvent["kind"][]): NoteStanding => {
  let now = standing;
  for (const kind of events) {
    now = standingAfter(now, { kind });
  }
  return now;
};

describe("what a note takes", () => {
  it("turns full and takes edits again once a compaction makes room", () => {
    expect(after(OPEN, ["filled"])).toStrictEqual(FULL);
    expect(after(OPEN, ["filled", "shrank"])).toStrictEqual(OPEN);
    expect(after(OPEN, ["shrank"])).toStrictEqual(OPEN);
  });

  it("keeps whether a note in Deleted is full, so a restore shows it as it is", () => {
    expect(after(FULL, ["deleted", "restored"])).toStrictEqual(FULL);
    expect(after(OPEN, ["deleted", "filled", "restored"])).toStrictEqual(FULL);
    expect(after(FULL, ["deleted", "shrank", "restored"])).toStrictEqual(OPEN);
    expect(after(OPEN, ["deleted", "deleted"])).toStrictEqual(deletedWith(false));
  });

  it("stays gone whatever comes after, a restore included", () => {
    for (const standing of [OPEN, FULL, deletedWith(true)]) {
      expect(after(standing, ["gone"])).toStrictEqual(GONE);
    }
    expect(after(GONE, ["restored", "shrank", "deleted", "filled"])).toStrictEqual(GONE);
  });

  it("refuses each write by the standing that holds it, and no other", () => {
    const writes: readonly NoteWrite[] = ["edit", "article", "undo"];
    const standings: readonly NoteStanding[] = [OPEN, FULL, deletedWith(false), GONE];
    const table = standings.map((standing) => writes.map((write) => refusedBy(standing, write)));
    expect(table).toStrictEqual([
      [null, null, null],
      ["full", null, null],
      ["deleted", null, null],
      ["gone", "gone", "gone"],
    ]);
  });

  it("reads back from its columns what it wrote, and a purge as gone", () => {
    for (const standing of [OPEN, FULL, deletedWith(true), deletedWith(false)]) {
      expect(standingOf({ ...standingColumns(standing), purged: 0 })).toStrictEqual(standing);
    }
    expect(standingOf({ deleted: 0, full: 0, purged: 1 })).toStrictEqual(GONE);
  });
});
