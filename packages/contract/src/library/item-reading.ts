// How a saved page's reading moves. An item's `reading` field is the one value: never asked (a
// note, a file), asked and waiting, read, or tried and failed. Every writer moves it through
// `withReading`, so no writer decides for itself what a reading may follow, and a read page lands
// by `withPage` on the item `takesRead` names, so the cell and the fake cell land one alike.

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

// an item's fields with the reading after `event`
export const withReading = (fields: LibraryItemFields, event: ReadingEvent): LibraryItemFields => ({
  ...fields,
  reading: readingAfter(fields.reading, event),
});

// what a read page brings to an item's fields, however it was read
export interface ReadPage {
  readonly title: string;
  readonly coverSha: string | null;
  readonly facts: Pick<LibraryItemFields, "author" | "description" | "lang" | "published" | "site">;
}

// an item's fields once a page is read into it, however it reached the item: what the page said of
// itself where it said anything (a value it did not give never removes one an import gave), its
// cover where it brought one, the reading's own state, and its title (empty when it gave none) only
// where the item has no name of its own
export const withPage = (
  fields: LibraryItemFields,
  page: ReadPage,
  now: number,
): LibraryItemFields => {
  const { facts } = page;
  return {
    ...withReading(fields, { at: now, kind: "read" }),
    author: facts.author ?? fields.author,
    coverSha: page.coverSha ?? fields.coverSha,
    description: facts.description ?? fields.description,
    lang: facts.lang ?? fields.lang,
    published: facts.published ?? fields.published,
    site: facts.site ?? fields.site,
    title: page.title !== "" && fields.title.trim() === "" ? page.title : fields.title,
  };
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
