// How a saved page's reading moves. An item's `reading` field is the one value: never asked (a
// note, a file), asked and waiting, read, or tried and failed. Every writer moves it through
// `readingOps`, so no writer decides for itself what a reading may follow.

import { sameJson } from "./canonical-json";
import type { FieldOp } from "./field-ops";
import type { LibraryItemFields } from "./library-item";

export type Reading = LibraryItemFields["reading"];

// a page saved or refreshed to be read, read, or tried and failed
export type ReadingEvent =
  | { readonly kind: "asked" }
  | { readonly kind: "read"; readonly at: number }
  | { readonly kind: "failed"; readonly at: number; readonly error: string };

// A reading lands only on an item that asked for one, and a failure never takes back a read; an
// ask keeps when the page was last read.
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

// the op for the reading after `event`, on the reading it was computed from; none where the event
// leaves it as it was
export const readingOps = (reading: Reading, event: ReadingEvent): FieldOp[] => {
  const next = readingAfter(reading, event);
  return sameJson(reading, next)
    ? []
    : [{ base: reading, field: "reading", op: "set", value: next }];
};
