// The rules a folder write and an organize meet, pure over a reader of the library's folders, and
// the files a landing names, so the cell and the fake cell refuse and land alike. A folder is
// guarded like a block by what its writer read (its name, its parent), no two live siblings share a
// name, since an agent files by the path of names from the top, and deleting a folder deletes the
// folders under it. An op already true lands nothing and refuses nothing.

import type { z } from "zod";

import { titleKey } from "./derive-item";
import { mergeListField } from "./field-ops";
import type { LibraryItemFields } from "./library-item";
import type { folderOpSchema, folderRowSchema } from "./library-wire";

type FolderOp = z.infer<typeof folderOpSchema>;
type FolderRow = z.infer<typeof folderRowSchema>;

// the library's folders as a host reads them
export interface FolderReader {
  // a folder by its id, live or deleted
  readonly folder: (id: string) => FolderRow | null;
  // the live folders under `parentId`, or at the top
  readonly children: (parentId: string | null) => readonly FolderRow[];
}

// why an op cannot land: the tree is no longer the one its writer read, or its parent is not live
export type FolderRefusal = "conflict" | "not-found";

// where an item is filed: a folder by id, by its path of names from the top, or none
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

const live = (row: FolderRow | null): FolderRow | null => (row?.deletedAt === null ? row : null);

// a conflict where a live sibling would share the folder's name
const namesake = (
  reader: FolderReader,
  folder: { readonly id: string; readonly parentId: string | null; readonly name: string },
): FolderRefusal | null => {
  const shared = reader
    .children(folder.parentId)
    .some(
      (sibling) => sibling.id !== folder.id && titleKey(sibling.name) === titleKey(folder.name),
    );
  return shared ? "conflict" : null;
};

// whether `ancestor` is `folderId` or a folder above it
const isAtOrAbove = (reader: FolderReader, ancestor: string, folderId: string | null): boolean => {
  const seen = new Set<string>();
  for (let at = folderId; at !== null && !seen.has(at); at = reader.folder(at)?.parentId ?? null) {
    if (at === ancestor) {
      return true;
    }
    seen.add(at);
  }
  return false;
};

const createRefusal = (reader: FolderReader, op: Op<"create">): FolderRefusal | null => {
  const held = reader.folder(op.id);
  if (held !== null) {
    const same = held.deletedAt === null && held.name === op.name && held.parentId === op.parentId;
    return same ? null : "conflict";
  }
  if (op.parentId !== null && live(reader.folder(op.parentId)) === null) {
    return "not-found";
  }
  return namesake(reader, op);
};

const renameRefusal = (reader: FolderReader, op: Op<"rename">): FolderRefusal | null => {
  const current = live(reader.folder(op.id));
  if (current === null || (current.name !== op.base && current.name !== op.name)) {
    return "conflict";
  }
  return namesake(reader, { ...current, name: op.name });
};

const moveRefusal = (reader: FolderReader, op: Op<"move">): FolderRefusal | null => {
  const current = live(reader.folder(op.id));
  if (current === null || current.parentId !== op.baseParentId) {
    return current?.parentId === op.parentId ? null : "conflict";
  }
  if (op.parentId !== null) {
    if (live(reader.folder(op.parentId)) === null) {
      return "not-found";
    }
    // a folder cannot go under itself: the tree the writer read did not hold it there
    if (isAtOrAbove(reader, op.id, op.parentId)) {
      return "conflict";
    }
  }
  return namesake(reader, { ...current, parentId: op.parentId });
};

// why an op cannot land, or null when it may
export const folderOpRefusal = (reader: FolderReader, op: FolderOp): FolderRefusal | null => {
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
    // no default
  }
};

// a folder and every live folder under it, deepest last
const subtreeOf = (reader: FolderReader, root: FolderRow): FolderRow[] => {
  const found: FolderRow[] = [root];
  // an array's iterator reads the entries pushed while it runs, so each folder's children follow
  for (const parent of found) {
    found.push(...reader.children(parent.id));
  }
  return found;
};

// the rows an op that may land changes, each as it leaves it, for the host to stamp with its
// write's sequence; none for an op already true
export const folderOpLanding = (
  reader: FolderReader,
  op: FolderOp,
  now: number,
): Omit<FolderRow, "seq">[] => {
  const held = reader.folder(op.id);
  switch (op.op) {
    case "create": {
      return held === null
        ? [{ deletedAt: null, id: op.id, name: op.name, parentId: op.parentId, sort: op.sort }]
        : [];
    }
    case "rename": {
      return held !== null && held.name !== op.name ? [{ ...held, name: op.name }] : [];
    }
    case "move": {
      return held !== null && (held.parentId !== op.parentId || held.sort !== op.sort)
        ? [{ ...held, parentId: op.parentId, sort: op.sort }]
        : [];
    }
    case "delete": {
      const current = live(held);
      return current === null
        ? []
        : subtreeOf(reader, current).map((folder) => ({ ...folder, deletedAt: now }));
    }
    // no default
  }
};

const tagKey = (tag: string): string => tag.toLowerCase();

// a tag added in another spelling of one the item keeps leaves the one kept, and one taken out and
// put back in another spelling is respelled where it stood
const tagsAfter = (tags: string[], input: OrganizeInput): string[] => {
  if (input.addTags === undefined && input.removeTags === undefined) {
    return tags;
  }
  const removed = new Set((input.removeTags ?? []).map(tagKey));
  const kept = tags.filter((tag) => !removed.has(tagKey(tag)));
  const held = new Set(kept.map(tagKey));
  const added = (input.addTags ?? []).filter((tag) => !held.has(tagKey(tag)));
  return mergeListField("tags", tags, tags, [...kept, ...added]);
};

// a pin keeps when it was pinned
const pinnedAtAfter = (held: number | null, pinned: boolean | undefined, now: number) => {
  if (pinned === undefined || pinned === (held !== null)) {
    return held;
  }
  return pinned ? now : null;
};

// an item's fields as an organize leaves them, `folderId` the folder its target named (undefined to
// leave the item where it is)
export const organized = (
  fields: LibraryItemFields,
  input: OrganizeInput,
  folderId: string | null | undefined,
  now: number,
): LibraryItemFields => ({
  ...fields,
  folderId: folderId === undefined ? fields.folderId : folderId,
  pinnedAt: pinnedAtAfter(fields.pinnedAt, input.pinned, now),
  tags: tagsAfter(fields.tags, input),
  title: input.title ?? fields.title,
});

// every file an item names: its original and cover by field, and each file its body embeds, as its
// digest read the body; a landing may name only a file the library holds, which is checked for the
// files the item named nowhere before it
export const itemFilesOf = (fields: LibraryItemFields, bodyFiles: readonly string[]): string[] => [
  ...new Set([fields.originalSha, fields.coverSha, ...bodyFiles].filter((sha) => sha !== null)),
];
