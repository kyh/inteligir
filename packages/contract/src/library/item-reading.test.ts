import { describe, expect, it } from "vitest";

import { applyFieldOps } from "./field-ops";
import { blankItemFields, stubFields } from "./item-makes";
import { readingAfter, readingOps, takesRead } from "./item-reading";
import type { Reading, ReadingEvent } from "./item-reading";
import { libraryItemFieldsSchema } from "./library-item";
import type { LibraryItemFields } from "./library-item";
import { paragraph } from "../test-support/library-items";

const AT = 1_700_000_000_000;
const LATER = AT + 60_000;
const WHY = "The page answered 404: it may have moved.";

const NONE: Reading = { state: "none" };
const WAITING: Reading = { at: null, state: "pending" };
// waiting to be read again
const AGAIN: Reading = { at: AT, state: "pending" };
const READ: Reading = { at: AT, state: "read" };
const FAILED: Reading = { at: AT, error: WHY, state: "failed" };

const ASKED: ReadingEvent = { kind: "asked" };
const LANDED: ReadingEvent = { at: LATER, kind: "read" };
const BROKE: ReadingEvent = { at: LATER, error: "Timed out.", kind: "failed" };

const linkWith = (reading: Reading): LibraryItemFields => ({
  ...stubFields({ folderId: null, savedAt: AT, tags: [], url: "https://example.com/a" }),
  reading,
});

// what landing `event`'s ops on a link holding `reading` leaves
const landed = (reading: Reading, event: ReadingEvent): Reading => {
  const fields = linkWith(reading);
  const outcome = applyFieldOps(fields, readingOps(fields.reading, event));
  if (outcome.kind !== "applied") {
    throw new Error(`the ops met ${outcome.kind}`);
  }
  return outcome.fields.reading;
};

describe("a saved page's reading", () => {
  it("is one value an item's fields hold, and no other pairing of its parts", () => {
    for (const reading of [NONE, WAITING, AGAIN, READ, FAILED]) {
      expect(libraryItemFieldsSchema.parse(linkWith(reading)).reading).toStrictEqual(reading);
    }
    for (const reading of [
      { at: AT, state: "failed" },
      { at: AT, error: "", state: "failed" },
      { at: null, state: "read" },
      { state: "filled" },
    ]) {
      expect(libraryItemFieldsSchema.validate({ ...linkWith(NONE), reading })).toBe(false);
    }
    // a read page says nothing of a failure, and a note nothing of a time
    expect(
      libraryItemFieldsSchema.parse({
        ...linkWith(NONE),
        reading: { at: AT, error: WHY, state: "read" },
      }).reading,
    ).toStrictEqual(READ);
    expect(
      libraryItemFieldsSchema.parse({ ...linkWith(NONE), reading: { at: AT, state: "none" } })
        .reading,
    ).toStrictEqual(NONE);
  });

  it("waits once asked, keeping when it was last read, and lands a reading or its failure", () => {
    expect(landed(NONE, ASKED)).toStrictEqual(WAITING);
    expect(landed(READ, ASKED)).toStrictEqual(AGAIN);
    expect(landed(FAILED, ASKED)).toStrictEqual(AGAIN);
    expect(landed(WAITING, LANDED)).toStrictEqual({ at: LATER, state: "read" });
    expect(landed(WAITING, BROKE)).toStrictEqual({
      at: LATER,
      error: "Timed out.",
      state: "failed",
    });
    expect(landed(FAILED, LANDED)).toStrictEqual({ at: LATER, state: "read" });
  });

  it("lands nothing on a note, and no failure over a read", () => {
    const note = blankItemFields(AT);
    expect(readingOps(note.reading, LANDED)).toStrictEqual([]);
    expect(readingOps(note.reading, BROKE)).toStrictEqual([]);
    expect(readingAfter(READ, BROKE)).toStrictEqual(READ);
  });

  it("is one op on the reading it was computed from, and none where an ask changes nothing", () => {
    expect(readingOps(WAITING, ASKED)).toStrictEqual([]);
    expect(readingOps(READ, ASKED)).toStrictEqual([
      { base: READ, field: "reading", op: "set", value: AGAIN },
    ]);
    // a reading that moved since refuses the op, however equal a copy of the base reads
    expect(applyFieldOps(linkWith(FAILED), readingOps(READ, ASKED))).toStrictEqual({
      kind: "conflict",
    });
    expect(applyFieldOps(linkWith({ ...READ }), readingOps(READ, ASKED)).kind).toBe("applied");
  });

  it("takes a device's read that found an article, only while it waits or failed with none of its own", () => {
    const found = { article: [paragraph("p1", "Read.")] };
    const takers = [NONE, WAITING, AGAIN, READ, FAILED].filter((reading) =>
      takesRead(reading, false, found),
    );
    expect(takers).toStrictEqual([WAITING, AGAIN, FAILED]);
    expect(takesRead(WAITING, true, found)).toBe(false);
    expect(takesRead(WAITING, false, { article: [] })).toBe(false);
  });
});
