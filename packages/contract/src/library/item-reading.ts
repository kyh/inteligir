// Where a saved page's reading stands, the one value an item's fetchState, fetchError and
// fetchedAt spell: never asked (a note, a file), asked and waiting, read, or tried and failed, each
// with when the page was last read. Every writer moves it through `readingOps` and every surface
// reads it through `readingOf`, so no writer or reader pairs the three fields its own way.

import type { FieldOp } from "./field-ops";
import type { LibraryItemFields } from "./library-item";

export type Reading =
  | { readonly state: "none" }
  | { readonly state: "pending"; readonly at: number | null }
  | { readonly state: "read"; readonly at: number | null }
  | { readonly state: "failed"; readonly at: number | null; readonly error: string };

type ReadingFields = Pick<LibraryItemFields, "fetchError" | "fetchState" | "fetchedAt">;

// what a failed reading says when no writer said why
const UNSAID_FAILURE = "The page couldn't be read.";

export const readingOf = (fields: ReadingFields): Reading => {
  switch (fields.fetchState) {
    case "none": {
      return { state: "none" };
    }
    case "pending": {
      return { at: fields.fetchedAt, state: "pending" };
    }
    case "filled": {
      return { at: fields.fetchedAt, state: "read" };
    }
    case "failed": {
      return { at: fields.fetchedAt, error: fields.fetchError ?? UNSAID_FAILURE, state: "failed" };
    }
    // no default
  }
};

// the three fields a reading is kept in, which a make lands it as
export const readingFields = (reading: Reading): ReadingFields => {
  switch (reading.state) {
    case "none": {
      return { fetchError: null, fetchState: "none", fetchedAt: null };
    }
    case "pending": {
      return { fetchError: null, fetchState: "pending", fetchedAt: reading.at };
    }
    case "read": {
      return { fetchError: null, fetchState: "filled", fetchedAt: reading.at };
    }
    case "failed": {
      return { fetchError: reading.error, fetchState: "failed", fetchedAt: reading.at };
    }
    // no default
  }
};

// a page saved or refreshed to be read, read, or tried and failed
export type ReadingEvent =
  | { readonly kind: "asked" }
  | { readonly kind: "read"; readonly at: number }
  | { readonly kind: "failed"; readonly at: number; readonly error: string };

// A reading lands only on an item that asked for one, and a failure never takes back a read; an
// ask keeps when the page was last read.
/** @internal */
export const readingAfter = (reading: Reading, event: ReadingEvent): Reading => {
  if (event.kind === "asked") {
    return { at: reading.state === "none" ? null : reading.at, state: "pending" };
  }
  if (reading.state === "none" || (event.kind === "failed" && reading.state === "read")) {
    return reading;
  }
  return event.kind === "read"
    ? { at: event.at, state: "read" }
    : { at: event.at, error: event.error, state: "failed" };
};

// the fields' ops for the reading after `event`, each on the value it was computed from; a field
// the event leaves as it was takes none
export const readingOps = (fields: ReadingFields, event: ReadingEvent): FieldOp[] => {
  const next = readingFields(readingAfter(readingOf(fields), event));
  const ops: FieldOp[] = [
    { base: fields.fetchState, field: "fetchState", op: "set", value: next.fetchState },
    { base: fields.fetchError, field: "fetchError", op: "set", value: next.fetchError },
    { base: fields.fetchedAt, field: "fetchedAt", op: "set", value: next.fetchedAt },
  ];
  return ops.filter((op) => op.op !== "set" || op.base !== op.value);
};
