// The rules a folder write and an organize meet, pure over a reader of the library's folders, so the
// cell and the fake cell refuse and land alike. A folder is guarded like a block by what its writer
// read (its name, its parent), no two live siblings share a name, since an agent files by the path
// of names from the top, and deleting a folder deletes the folders under it. An op already true
// lands nothing and refuses nothing.

import type { z } from "zod";

import { titleKey } from "./derive-item";
import type { FieldOp } from "./field-ops";
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

// what an op met instead of its base: the folder it names as it now stands, or a parent no longer
// live
export type FolderRefusal =
  | { readonly kind: "conflict"; readonly id: string; readonly current: FolderRow | null }
  | { readonly kind: "not-found" };

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

const conflictOf = (id: string, current: FolderRow | null): FolderRefusal => ({
  current,
  id,
  kind: "conflict",
});

// the live sibling another folder would share a name with, as a conflict naming it
const namesake = (
  reader: FolderReader,
  folder: { readonly id: string; readonly parentId: string | null; readonly name: string },
): FolderRefusal | null => {
  const clash = reader
    .children(folder.parentId)
    .find(
      (sibling) => sibling.id !== folder.id && titleKey(sibling.name) === titleKey(folder.name),
    );
  return clash === undefined ? null : conflictOf(clash.id, clash);
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
    return same ? null : conflictOf(op.id, held);
  }
  if (op.parentId !== null && live(reader.folder(op.parentId)) === null) {
    return { kind: "not-found" };
  }
  return namesake(reader, op);
};

const renameRefusal = (reader: FolderReader, op: Op<"rename">): FolderRefusal | null => {
  const held = reader.folder(op.id);
  const current = live(held);
  if (current === null || (current.name !== op.base && current.name !== op.name)) {
    return conflictOf(op.id, held);
  }
  return namesake(reader, { ...current, name: op.name });
};

const moveRefusal = (reader: FolderReader, op: Op<"move">): FolderRefusal | null => {
  const held = reader.folder(op.id);
  const current = live(held);
  if (current === null || current.parentId !== op.baseParentId) {
    return current?.parentId === op.parentId ? null : conflictOf(op.id, held);
  }
  if (op.parentId !== null) {
    const parent = live(reader.folder(op.parentId));
    if (parent === null) {
      return { kind: "not-found" };
    }
    // a folder cannot go under itself: the tree the writer read did not hold it there
    if (isAtOrAbove(reader, op.id, op.parentId)) {
      return conflictOf(parent.id, parent);
    }
  }
  return namesake(reader, { ...current, parentId: op.parentId });
};

// what an op met instead of its base, or null when it may land
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

// the field ops an organize lands on one item's fields, `folderId` the folder its target named
// (undefined to leave the item where it is)
export const organizeOps = (
  fields: LibraryItemFields,
  input: OrganizeInput,
  folderId: string | null | undefined,
  now: number,
): FieldOp[] => {
  const ops: FieldOp[] = [];
  if (input.addTags !== undefined || input.removeTags !== undefined) {
    const removed = new Set((input.removeTags ?? []).map(tagKey));
    const kept = fields.tags.filter((tag) => !removed.has(tagKey(tag)));
    const held = new Set(kept.map(tagKey));
    const added = (input.addTags ?? []).filter((tag) => !held.has(tagKey(tag)));
    ops.push({ base: fields.tags, op: "tags", value: [...kept, ...new Set(added)] });
  }
  if (folderId !== undefined && folderId !== fields.folderId) {
    ops.push({ base: fields.folderId, field: "folderId", op: "set", value: folderId });
  }
  if (input.pinned !== undefined && input.pinned !== (fields.pinnedAt !== null)) {
    const value = input.pinned ? now : null;
    ops.push({ base: fields.pinnedAt, field: "pinnedAt", op: "set", value });
  }
  if (input.title !== undefined && input.title !== fields.title) {
    ops.push({ base: fields.title, field: "title", op: "set", value: input.title });
  }
  return ops;
};
