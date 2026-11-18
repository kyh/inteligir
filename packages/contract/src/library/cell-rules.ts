import type { z } from "zod";

import { titleKey } from "./derive-item";
import { mergeListField } from "./field-ops";
import type { LibraryItemFields } from "./library-item";
import type { folderOpSchema, folderRowSchema } from "./library-wire";

type FolderOp = z.infer<typeof folderOpSchema>;

type FolderRow = z.infer<typeof folderRowSchema>;

export interface FolderReader {
  readonly folder: (id: string) => FolderRow | null;
  readonly children: (parentId: string | null) => readonly FolderRow[];
}

type FolderRefusal = "conflict" | "not-found";

export type FolderTarget = { readonly id: string } | { readonly path: string } | null;

export interface OrganizeInput {
  readonly ids: readonly string[];
  readonly addTags?: readonly string[] | undefined;
  readonly removeTags?: readonly string[] | undefined;
  readonly folder?: FolderTarget | undefined;
  readonly pinned?: boolean | undefined;
  readonly title?: string | undefined;
}

type Op<K extends FolderOp["op"]> = Extract<FolderOp, { op: K }>;

const live = (row: FolderRow | null) => (row?.deletedAt === null ? row : null);

const namesake = (
  reader: FolderReader,
  folder: { readonly id: string; readonly parentId: string | null; readonly name: string },
) => {
  const shared = reader
    .children(folder.parentId)
    .some(
      (sibling) => sibling.id !== folder.id && titleKey(sibling.name) === titleKey(folder.name),
    );

  return (shared ? "conflict" : null) satisfies FolderRefusal | null;
};

const isAtOrAbove = (reader: FolderReader, ancestor: string, folderId: string | null) => {
  const seen = new Set<string>();

  for (let at = folderId; at !== null && !seen.has(at); at = reader.folder(at)?.parentId ?? null) {
    if (at === ancestor) {
      return true;
    }

    seen.add(at);
  }

  return false;
};

const createRefusal = (reader: FolderReader, op: Op<"create">) => {
  const held = reader.folder(op.id);

  if (held !== null) {
    const same = held.deletedAt === null && held.name === op.name && held.parentId === op.parentId;

    return (same ? null : "conflict") satisfies FolderRefusal | null;
  }

  if (op.parentId !== null && live(reader.folder(op.parentId)) === null) {
    return "not-found" as const;
  }

  return namesake(reader, op);
};

const renameRefusal = (reader: FolderReader, op: Op<"rename">) => {
  const current = live(reader.folder(op.id));

  if (current === null || (current.name !== op.base && current.name !== op.name)) {
    return "conflict" as const;
  }

  return namesake(reader, { ...current, name: op.name });
};

const moveRefusal = (reader: FolderReader, op: Op<"move">) => {
  const current = live(reader.folder(op.id));

  if (current === null || current.parentId !== op.baseParentId) {
    return (current?.parentId === op.parentId ? null : "conflict") satisfies FolderRefusal | null;
  }

  if (op.parentId !== null) {
    if (live(reader.folder(op.parentId)) === null) {
      return "not-found" as const;
    }

    if (isAtOrAbove(reader, op.id, op.parentId)) {
      return "conflict" as const;
    }
  }

  return namesake(reader, { ...current, parentId: op.parentId });
};

export const folderOpRefusal = (reader: FolderReader, op: FolderOp) => {
  switch (op.op) {
    case "create": {
      return createRefusal(reader, op);
    }

    case "rename": {
      return renameRefusal(reader, op);
    }

    case "move": {
      return moveRefusal(reader, op);
    }

    case "delete": {
      return null;
    }

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
};

const subtreeOf = (reader: FolderReader, root: FolderRow) => {
  const found: FolderRow[] = [root];

  for (const parent of found) {
    found.push(...reader.children(parent.id));
  }

  return found;
};

export const folderOpLanding = (reader: FolderReader, op: FolderOp, now: number) => {
  const held = reader.folder(op.id);

  switch (op.op) {
    case "create": {
      return (
        held === null
          ? [{ deletedAt: null, id: op.id, name: op.name, parentId: op.parentId, sort: op.sort }]
          : []
      ) satisfies Omit<FolderRow, "seq">[];
    }

    case "rename": {
      return (
        held !== null && held.name !== op.name ? [{ ...held, name: op.name }] : []
      ) satisfies Omit<FolderRow, "seq">[];
    }

    case "move": {
      return (
        held !== null && (held.parentId !== op.parentId || held.sort !== op.sort)
          ? [{ ...held, parentId: op.parentId, sort: op.sort }]
          : []
      ) satisfies Omit<FolderRow, "seq">[];
    }

    case "delete": {
      const current = live(held);

      return (
        current === null
          ? []
          : subtreeOf(reader, current).map((folder) => ({ ...folder, deletedAt: now }))
      ) satisfies Omit<FolderRow, "seq">[];
    }

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
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
  folderId: string | null | undefined,
  now: number,
) =>
  ({
    ...fields,
    folderId: folderId === undefined ? fields.folderId : folderId,
    pinnedAt: pinnedAtAfter(fields.pinnedAt, input.pinned, now),
    tags: tagsAfter(fields.tags, input),
    title: input.title ?? fields.title,
  }) satisfies LibraryItemFields;

export const itemFilesOf = (fields: LibraryItemFields, bodyFiles: readonly string[]) =>
  [
    ...new Set([fields.originalSha, fields.coverSha, ...bodyFiles].filter((sha) => sha !== null)),
  ] satisfies string[];
