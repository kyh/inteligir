import type { LibraryItemFields } from "./library-item";
import type { LibraryBlock } from "./library-nodes";

export type Reading = LibraryItemFields["reading"];

export type ReadingEvent =
  | { readonly kind: "asked" }
  | { readonly kind: "read"; readonly at: number }
  | { readonly kind: "failed"; readonly at: number; readonly error: string };

export const readingAfter = (reading: Reading, event: ReadingEvent) => {
  if (event.kind === "asked") {
    return { at: reading.state === "none" ? null : reading.at, state: "pending" } satisfies Reading;
  }

  if (reading.state === "none" || (event.kind === "failed" && reading.state === "read")) {
    return reading;
  }

  return (
    event.kind === "read"
      ? { at: event.at, state: "read" }
      : { at: event.at, error: event.error, state: "failed" }
  ) satisfies Reading;
};

export const withReading = (fields: LibraryItemFields, event: ReadingEvent) =>
  ({
    ...fields,
    reading: readingAfter(fields.reading, event),
  }) satisfies LibraryItemFields;

export interface ReadPage {
  readonly title: string;
  readonly coverSha: string | null;
  readonly facts: Pick<LibraryItemFields, "author" | "description" | "lang" | "published" | "site">;
}

export const withPage = (fields: LibraryItemFields, page: ReadPage, now: number) => {
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
  } satisfies LibraryItemFields;
};

export const takesRead = (
  reading: Reading,
  hasArticle: boolean,
  read: { readonly article: readonly LibraryBlock[] },
) =>
  read.article.length > 0 &&
  !hasArticle &&
  (reading.state === "pending" || reading.state === "failed");
