import { describe, expect, it } from "vitest";

import { applyFieldOps } from "./field-ops";
import { blankItemFields, stubFields } from "./item-makes";
import { readingAfter, readingFields, readingOf, readingOps } from "./item-reading";
import type { Reading, ReadingEvent } from "./item-reading";
import { FETCH_STATES } from "./library-item";
import type { LibraryItemFields } from "./library-item";

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

// a link's fields holding `reading`, and what landing `event`'s ops on them leaves
const landed = (reading: Reading, event: ReadingEvent): Reading => {
  const fields: LibraryItemFields = {
    ...stubFields({ folderId: null, savedAt: AT, tags: [], url: "https://example.com/a" }),
    ...readingFields(reading),
  };
  const outcome = applyFieldOps(fields, readingOps(fields, event));
  if (outcome.kind !== "applied") {
    throw new Error(`the ops met ${outcome.kind}`);
  }
  return readingOf(outcome.fields);
};

describe("a saved page's reading", () => {
  it("reads every triple of its fields as one reading, a failure that said nothing included", () => {
    const errors = [null, WHY];
    const times = [null, AT];
    const read = FETCH_STATES.flatMap((fetchState) =>
      errors.flatMap((fetchError) =>
        times.map((fetchedAt) => readingOf({ fetchError, fetchState, fetchedAt })),
      ),
    );
    expect(read).toStrictEqual([
      NONE,
      NONE,
      NONE,
      NONE,
      WAITING,
      AGAIN,
      WAITING,
      AGAIN,
      { at: null, state: "read" },
      READ,
      { at: null, state: "read" },
      READ,
      { at: null, error: "The page couldn't be read.", state: "failed" },
      { at: AT, error: "The page couldn't be read.", state: "failed" },
      { at: null, error: WHY, state: "failed" },
      FAILED,
    ]);
  });

  it("writes each reading back as the fields it reads from", () => {
    for (const reading of [NONE, WAITING, READ, FAILED, AGAIN]) {
      expect(readingOf(readingFields(reading))).toStrictEqual(reading);
    }
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
    expect(readingOps(note, LANDED)).toStrictEqual([]);
    expect(readingOps(note, BROKE)).toStrictEqual([]);
    expect(readingAfter(READ, BROKE)).toStrictEqual(READ);
  });

  it("names no field an ask leaves as it was", () => {
    expect(readingOps(readingFields(WAITING), ASKED)).toStrictEqual([]);
    expect(readingOps(readingFields(READ), ASKED)).toStrictEqual([
      { base: "filled", field: "fetchState", op: "set", value: "pending" },
    ]);
  });
});
