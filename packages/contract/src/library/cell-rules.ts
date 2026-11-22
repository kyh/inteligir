import { canHoldKind } from "../items/item-kind";
import type { ItemKind } from "../items/item-kind";
import { mergeListField } from "./field-ops";
import type { LibraryItemFields } from "./library-item";

export interface ParentNode {
  readonly kind: ItemKind;
  readonly parentId: string | null;
  readonly deletedAt: number | null;
}

export interface ParentReader {
  readonly item: (id: string) => ParentNode | null;
}

export type ParentTarget = { readonly id: string } | { readonly path: string } | null;

export interface OrganizeInput {
  readonly ids: readonly string[];
  readonly addTags?: readonly string[] | undefined;
  readonly removeTags?: readonly string[] | undefined;
  readonly parent?: ParentTarget | undefined;
  readonly pinned?: boolean | undefined;
  readonly title?: string | undefined;
}

export const lineOf = (reader: ParentReader, from: string | null) => {
  const line = new Set<string>();

  for (let at = from; at !== null && !line.has(at); at = reader.item(at)?.parentId ?? null) {
    line.add(at);
  }

  return line;
};

export const parentRefusal = (
  reader: ParentReader,
  child: { readonly id: string; readonly kind: ItemKind },
  parentId: string | null,
) => {
  if (parentId === null) {
    return null;
  }

  const parent = reader.item(parentId);

  if (parent === null || parent.deletedAt !== null) {
    return "not-found" as const;
  }

  return (
    !canHoldKind(parent.kind, child.kind) || lineOf(reader, parentId).has(child.id)
      ? "conflict"
      : null
  ) satisfies "conflict" | "not-found" | null;
};

const tagKey = (tag: string) => tag.toLowerCase();

const tagsAfter = (tags: string[], input: OrganizeInput) => {
  if (input.addTags === undefined && input.removeTags === undefined) {
    return tags;
  }

  const removed = new Set((input.removeTags ?? []).map(tagKey));
  const kept = tags.filter((tag) => !removed.has(tagKey(tag)));
  const held = new Set(kept.map(tagKey));
  const added = (input.addTags ?? []).filter((tag) => !held.has(tagKey(tag)));

  return mergeListField("tags", tags, tags, [...kept, ...added]);
};

const pinnedAtAfter = (held: number | null, pinned: boolean | undefined, now: number) => {
  if (pinned === undefined || pinned === (held !== null)) {
    return held;
  }

  return pinned ? now : null;
};

export const organized = (
  fields: LibraryItemFields,
  input: OrganizeInput,
  parentId: string | null | undefined,
  now: number,
) =>
  ({
    ...fields,
    parentId: parentId === undefined ? fields.parentId : parentId,
    pinnedAt: pinnedAtAfter(fields.pinnedAt, input.pinned, now),
    tags: tagsAfter(fields.tags, input),
    title: input.title ?? fields.title,
  }) satisfies LibraryItemFields;

export const itemFilesOf = (fields: LibraryItemFields, bodyFiles: readonly string[]) =>
  [
    ...new Set([fields.originalSha, fields.coverSha, ...bodyFiles].filter((sha) => sha !== null)),
  ] satisfies string[];
