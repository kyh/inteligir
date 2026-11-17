// What a make's fields are, spelled once: the cell lands an item by them, a device lays the same
// fields over its screens before the cell answers, so a card reads alike on both sides of its
// landing, and an import builds each item it read from them.

import { fileKindOf, fileKindOfMime } from "../items/item-kind";
import { cleanUrl, kindForUrl } from "../items/item-url";
import type { ImportedFields, LibraryItemFields } from "./library-item";

// where a make files what it makes
interface Filing {
  readonly folderId: string | null;
  readonly savedAt: number;
  readonly tags: readonly string[];
}

// an item's fields before its writer sets any: a note saved at `savedAt`, filed nowhere
export const blankItemFields = (savedAt: number): LibraryItemFields => ({
  aliases: [],
  author: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  folderId: null,
  kind: "note",
  lang: null,
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  reading: { state: "none" },
  savedAt,
  site: null,
  tags: [],
  title: "",
  url: null,
});

const filedFields = (input: Filing): LibraryItemFields => ({
  ...blankItemFields(input.savedAt),
  folderId: input.folderId,
  tags: [...new Set(input.tags)],
});

export const noteFields = (input: Filing & { readonly title: string }): LibraryItemFields => ({
  ...filedFields(input),
  title: input.title,
});

// an address saved to read later: unread, and with no name unless its save gave one, so its card
// goes by the address until its page names it
export const stubFields = (
  input: Filing & { readonly url: string; readonly title?: string | undefined },
): LibraryItemFields => ({
  ...filedFields(input),
  kind: kindForUrl(input.url),
  reading: { at: null, state: "pending" },
  title: input.title ?? "",
  url: cleanUrl(input.url),
});

type PageFacts = Pick<LibraryItemFields, "author" | "description" | "lang" | "published" | "site">;

// a page a device read itself, read as of `readAt`
export const pageFields = (
  input: Filing & {
    readonly url: string;
    readonly title: string;
    readonly coverSha: string | null;
    readonly facts: PageFacts;
  },
  readAt: number,
): LibraryItemFields => ({
  ...filedFields(input),
  ...input.facts,
  coverSha: input.coverSha,
  kind: kindForUrl(input.url),
  reading: { at: readAt, state: "read" },
  title: input.title,
  url: cleanUrl(input.url),
});

// a file: its kind from the type it was uploaded as, else its name; an image is its own cover
export const fileFields = (
  input: Filing & {
    readonly name: string;
    readonly sha: string;
    readonly mime: string;
    readonly title?: string | undefined;
  },
): LibraryItemFields => {
  const byType = fileKindOfMime(input.mime);
  const kind = byType === "file" ? (fileKindOf(input.name) ?? "file") : byType;
  const stem = input.name.replace(/\.[^.]+$/u, "");
  return {
    ...filedFields(input),
    coverSha: kind === "image" ? input.sha : null,
    kind,
    originalName: input.name,
    originalSha: input.sha,
    title: input.title ?? (stem === "" ? input.name : stem),
  };
};

// a make as an import sends it, its place left to the folder the import names
export const importedFields = ({
  deletedAt: _deletedAt,
  folderId: _folderId,
  ...fields
}: LibraryItemFields): ImportedFields => fields;
