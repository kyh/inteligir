// How a saved page's reading moves. An item's `reading` field is the one value: never asked (a
// note, a file), asked and waiting, read, or tried and failed. Every writer moves it through
// `readingOps`, so no writer decides for itself what a reading may follow, and a read page lands
// by `pageFieldOps` on the item `takesRead` names, so the cell and the fake cell land one alike.

import { sameJson } from "./canonical-json";
import { changes } from "./field-ops";
import type { FieldOp } from "./field-ops";
import type { LibraryItemFields } from "./library-item";
import type { LibraryBlock } from "./library-nodes";

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

const FACT_FIELDS = ["author", "description", "lang", "published", "site"] as const;

// what a read page brings to an item's fields, however it was read
export interface ReadPage {
  readonly title: string;
  readonly coverSha: string | null;
  readonly facts: Pick<LibraryItemFields, (typeof FACT_FIELDS)[number]>;
}

// the fields a read page sets, however it reached the item: what it said of itself where it said
// anything (a value it did not give never removes one an import gave), its cover where it brought
// one, the reading's own state, and its title (empty when it gave none) only where the item has
// no name of its own
export const pageFieldOps = (fields: LibraryItemFields, page: ReadPage, now: number): FieldOp[] => {
  const ops: FieldOp[] = [];
  for (const field of FACT_FIELDS) {
    const value = page.facts[field];
    if (value !== null) {
      ops.push({ base: fields[field], field, op: "set", value });
    }
  }
  if (page.coverSha !== null) {
    ops.push({ base: fields.coverSha, field: "coverSha", op: "set", value: page.coverSha });
  }
  ops.push(...readingOps(fields.reading, { at: now, kind: "read" }));
  if (page.title !== "" && fields.title.trim() === "") {
    ops.push({ base: fields.title, field: "title", op: "set", value: page.title });
  }
  return ops.filter(changes);
};

// whether the item that holds a page's address takes a device's read of it: a read that found an
// article, while the item has none of its own to lose and its reading waits or failed. A read that
// found none leaves a waiting item to the cloud's
export const takesRead = (
  reading: Reading,
  hasArticle: boolean,
  read: { readonly article: readonly LibraryBlock[] },
): boolean =>
  read.article.length > 0 &&
  !hasArticle &&
  (reading.state === "pending" || reading.state === "failed");
