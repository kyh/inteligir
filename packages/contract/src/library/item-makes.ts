import { fileKindOf, fileKindOfMime } from "../items/item-kind";
import { cleanUrl, kindForUrl } from "../items/item-url";
import type { LibraryItemFields } from "./library-item";

interface Filing {
  readonly parentId: string | null;
  readonly savedAt: number;
  readonly tags: readonly string[];
}

export const blankItemFields = (savedAt: number) =>
  ({
    aliases: [],
    author: null,
    coverSha: null,
    deletedAt: null,
    description: null,
    parentId: null,
    kind: "note",
    lang: null,
    list: null,
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
  }) satisfies LibraryItemFields;

const filedFields = (input: Filing) =>
  ({
    ...blankItemFields(input.savedAt),
    parentId: input.parentId,
    tags: [...new Set(input.tags)],
  }) satisfies LibraryItemFields;

export const noteFields = (input: Filing & { readonly title: string }) =>
  ({
    ...filedFields(input),
    title: input.title,
  }) satisfies LibraryItemFields;

export const stubFields = (
  input: Filing & { readonly url: string; readonly title?: string | undefined },
) =>
  ({
    ...filedFields(input),
    kind: kindForUrl(input.url),
    reading: { at: null, state: "pending" },
    title: input.title ?? "",
    url: cleanUrl(input.url),
  }) satisfies LibraryItemFields;

type PageFacts = Pick<LibraryItemFields, "author" | "description" | "lang" | "published" | "site">;

export const pageFields = (
  input: Filing & {
    readonly url: string;
    readonly title: string;
    readonly coverSha: string | null;
    readonly facts: PageFacts;
  },
  readAt: number,
) =>
  ({
    ...filedFields(input),
    ...input.facts,
    coverSha: input.coverSha,
    kind: kindForUrl(input.url),
    reading: { at: readAt, state: "read" },
    title: input.title,
    url: cleanUrl(input.url),
  }) satisfies LibraryItemFields;

export const fileFields = (
  input: Filing & {
    readonly name: string;
    readonly sha: string;
    readonly mime: string;
    readonly title?: string | undefined;
  },
) => {
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
  } satisfies LibraryItemFields;
};

export const importedFields = ({
  deletedAt: _deletedAt,
  parentId: _parentId,
  ...fields
}: LibraryItemFields) => fields;
