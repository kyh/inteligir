// What the grid, its menu, Info and the palette do to items, as writes through the replica's outbox:
// each one queued at once, laid over what the screens read, and sent once the cell can take it, so
// a pin, a move or a tag reads as done before it lands. A write is computed over the item as the
// screen read it; one whose base moved since (another device's write landed first) is read again
// and written once more over what it reads now. Emptying Deleted is the cell's alone: a purge has
// no overlay to show, so it goes as a call that needs a connection.

import { BULK_ITEMS_MAX } from "@repo/contract/cloud/library/library-wire";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import { mergeListField } from "@repo/notes/library/block-ops";
import { ordBetween } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { uuidV7 } from "@repo/notes/library/uuid-v7";

import type { CloudWire } from "../cloud/v1";

type FieldsOp = (fields: LibraryItemFields) => LibraryOp[];

// one item's fields patch, written over the item as it reads now; true when it is queued or was
// already so
const patchItem = async (
  replica: LibraryReplica,
  itemId: string,
  opsOf: FieldsOp,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const held = await replica.item(itemId);
    if (held === null) {
      return false;
    }
    const ops = opsOf(held.fields);
    if (ops.length === 0) {
      return true;
    }
    const outcome = await replica.write(itemId, { ops });
    if (outcome.kind === "queued" || outcome.kind === "unchanged") {
      return true;
    }
    if (outcome.kind !== "changed") {
      return false;
    }
  }
  return false;
};

const patchAll = async (
  replica: LibraryReplica,
  itemIds: readonly string[],
  opsOf: FieldsOp,
): Promise<number> => {
  let landed = 0;
  for (const itemId of itemIds) {
    if (await patchItem(replica, itemId, opsOf)) {
      landed += 1;
    }
  }
  return landed;
};

export const pinItems = async (
  replica: LibraryReplica,
  itemIds: readonly string[],
  pinned: boolean,
): Promise<number> =>
  await patchAll(replica, itemIds, (fields) =>
    (fields.pinnedAt !== null) === pinned
      ? []
      : [
          {
            base: fields.pinnedAt,
            field: "pinnedAt",
            op: "set",
            value: pinned ? Date.now() : null,
          },
        ],
  );

export const moveItems = async (
  replica: LibraryReplica,
  itemIds: readonly string[],
  folderId: string | null,
): Promise<number> =>
  await patchAll(replica, itemIds, (fields) =>
    fields.folderId === folderId
      ? []
      : [{ base: fields.folderId, field: "folderId", op: "set", value: folderId }],
  );

export interface TagChange {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

export const tagItems = async (
  replica: LibraryReplica,
  itemIds: readonly string[],
  change: TagChange,
): Promise<number> =>
  await patchAll(replica, itemIds, (fields) => {
    const removed = new Set(change.remove.map((tag) => tag.toLowerCase()));
    const value = mergeListField(
      "tags",
      fields.tags.filter((tag) => !removed.has(tag.toLowerCase())),
      [],
      change.add,
    );
    return value.length === fields.tags.length &&
      value.every((tag, index) => tag === fields.tags[index])
      ? []
      : [{ base: fields.tags, op: "tags", value }];
  });

export const retitleItem = async (
  replica: LibraryReplica,
  itemId: string,
  title: string,
): Promise<boolean> =>
  await patchItem(replica, itemId, (fields) =>
    fields.title === title ? [] : [{ base: fields.title, field: "title", op: "set", value: title }],
  );

const chunked = <T>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += BULK_ITEMS_MAX) {
    out.push(items.slice(start, start + BULK_ITEMS_MAX));
  }
  return out;
};

// emptying Deleted: the bodies and highlights go for good, and each id stays as a tombstone
export const purgeItems = async (wire: CloudWire, itemIds: readonly string[]): Promise<number> => {
  let purged = 0;
  for (const ids of chunked(itemIds)) {
    const answer = await wire.client.library.items.purge({ ids });
    purged += answer.purged.length;
  }
  return purged;
};

// a folder made under `parentId`, after its last sibling, with an id this device mints
export const createFolder = async (
  replica: LibraryReplica,
  name: string,
  parentId: string | null,
): Promise<string> => {
  const siblings = replica
    .folders()
    .filter((folder) => folder.parentId === parentId)
    .map((folder) => folder.sort)
    .toSorted();
  const id = uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));
  await replica.writeFolders([
    { id, name, op: "create", parentId, sort: ordBetween(siblings.at(-1) ?? null, null) },
  ]);
  return id;
};

export const renameFolder = async (
  replica: LibraryReplica,
  folderId: string,
  name: string,
): Promise<void> => {
  const held = replica.folders().find((folder) => folder.id === folderId);
  if (held === undefined || held.name === name) {
    return;
  }
  await replica.writeFolders([{ base: held.name, id: folderId, name, op: "rename" }]);
};

export const deleteFolder = async (replica: LibraryReplica, folderId: string): Promise<void> => {
  await replica.writeFolders([{ id: folderId, op: "delete" }]);
};
