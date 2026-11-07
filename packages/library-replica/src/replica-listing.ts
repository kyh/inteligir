// What the screens read: each item as the cell last sent it with this device's unsent rows laid
// over, and the listing's rows built from them. An item a row names is derived again from the
// laid state, so its card, tags and place read as the person wrote them; one no row names reads
// as it landed. A body still to come leaves the card the cell sent, retitled if a field moved.

import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import type { ItemState, StoredBlock } from "@repo/notes/library/block-ops";
import { orderedBlocks } from "@repo/notes/library/block-ops";
import { deriveItem } from "@repo/notes/library/derive-item";
import type { ItemCard } from "@repo/notes/library/derive-item";
import type { ListingFolder, ListingRow } from "@repo/notes/library/library-index";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import {
  readAnnotations,
  readItem,
  readItemState,
  readLiveItems,
} from "@repo/notes/library/library-queries";
import type { StoredItem } from "@repo/notes/library/library-queries";
import { all } from "@repo/notes/library/library-sql";
import type { SqlPlan } from "@repo/notes/library/library-sql";
import { urlKey } from "@repo/notes/items/item-url";
import { z } from "zod";

import { itemIdsOf } from "./outbox-ops";
import type { OutboxOp } from "./outbox-ops";
import type { OutboxRow } from "./outbox-rows";
import { layAnnotations, layRow } from "./overlay";
import { readTagsByItem } from "./replica-rows";

// an item as a screen reads it
export interface ReplicaItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  // in reading order: the note, then the article
  readonly blocks: readonly StoredBlock[];
  readonly card: ItemCard;
  // the sequence of the row the cell sent; null for one this device made that has not landed
  readonly seq: number | null;
  // false while its body is still to come from the cloud
  readonly bodyHeld: boolean;
  // a write of this device's on it has not landed
  readonly unsent: boolean;
  // a write on it was refused and waits for the person
  readonly parked: boolean;
}

// a listing row, with what a card draws beside what the listing filters by
export interface ReplicaListingRow extends ListingRow {
  readonly fields: LibraryItemFields;
  readonly card: ItemCard;
  readonly unsent: boolean;
  readonly parked: boolean;
}

// the rows that name an item, oldest first
export const rowsNaming = (rows: readonly OutboxRow[], itemId: string): OutboxRow[] =>
  rows.filter((row) => itemIdsOf(row.op).includes(itemId));

const isWanted = function* isWanted(itemId: string): SqlPlan<boolean> {
  const rows = yield all("SELECT item_id FROM body_wants WHERE item_id = ?", [itemId]);
  return rows.length > 0;
};

const holderSchema = z.object({ id: z.string() });

// the live item at a page's address, as the cell finds the one a save folds onto
export const heldAtAddress = function* heldAtAddress(url: string): SqlPlan<string | null> {
  const key = urlKey(url);
  if (key === null) {
    return null;
  }
  const [row] = yield all(
    "SELECT id FROM items WHERE url_key = ? AND deleted_at IS NULL AND purged = 0 LIMIT 1",
    [key],
  );
  return row === undefined ? null : holderSchema.parse(row).id;
};

interface Held {
  readonly stored: Extract<StoredItem, { kind: "live" }> | null;
  readonly state: ItemState | null;
  readonly wanted: boolean;
}

// the card the cell sent, until a row of this device's changes the item: then the laid state's,
// or with its body still to come the cell's retitled
const cardOf = (
  stored: Held["stored"],
  state: ItemState,
  unsent: boolean,
  bodyHeld: boolean,
): ItemCard => {
  if (stored === null || (unsent && bodyHeld)) {
    return deriveItem(state.fields, state.blocks).card;
  }
  if (!unsent) {
    return stored.card;
  }
  return {
    ...stored.card,
    title: state.fields.title === "" ? stored.card.title : state.fields.title,
  };
};

// the rows laid over the item as it is held; null when it is neither held nor made
const laidItem = (id: string, held: Held, pending: readonly OutboxRow[]): ReplicaItem | null => {
  let { state } = held;
  for (const row of pending) {
    state = layRow(state, row.op, row.createdAt);
  }
  if (state === null) {
    return null;
  }
  const { stored } = held;
  const bodyHeld = stored === null || !held.wanted || (held.state?.blocks.size ?? 0) > 0;
  const card = cardOf(stored, state, pending.length > 0, bodyHeld);
  return {
    blocks: orderedBlocks(state.blocks),
    bodyHeld,
    card,
    fields: state.fields,
    id,
    parked: pending.some((row) => row.state === "parked"),
    seq: stored?.seq ?? null,
    unsent: pending.length > 0,
  };
};

// one item as a screen reads it, a tombstone reading as nothing
export const readReplicaItem = function* readReplicaItem(
  id: string,
  pending: readonly OutboxRow[],
): SqlPlan<ReplicaItem | null> {
  const found = yield* readItem(id);
  if (found?.kind === "purged") {
    return null;
  }
  const state = found === null ? null : yield* readItemState(id);
  const wanted = yield* isWanted(id);
  return laidItem(id, { state, stored: found, wanted }, pending);
};

// an item's highlights with its unsent writes' highlight ops laid over
export const readReplicaAnnotations = function* readReplicaAnnotations(
  itemId: string,
  pending: readonly OutboxRow[],
  nowSeconds: number,
): SqlPlan<AnnotationStore> {
  let store = yield* readAnnotations(itemId);
  for (const row of pending) {
    if (row.op.kind === "write" && row.op.itemId === itemId) {
      store = layAnnotations(store, row.op.annotations, nowSeconds);
    }
  }
  return store;
};

const uniqueTags = (tags: readonly string[]): string[] => [...new Set(tags)];

const listingRowOf = (
  item: ReplicaItem,
  tags: readonly string[],
  updatedAt: number,
): ReplicaListingRow => ({
  card: item.card,
  deletedAt: item.fields.deletedAt,
  fields: item.fields,
  folderId: item.fields.folderId,
  id: item.id,
  kind: item.fields.kind,
  parked: item.parked,
  pinnedAt: item.fields.pinnedAt,
  savedAt: item.fields.savedAt,
  tags,
  title: item.card.title,
  unsent: item.unsent,
  updatedAt,
  url: item.fields.url,
});

// an item a row names: its tags derived from the laid state, as the cell will derive them
const laidListingRow = (
  item: ReplicaItem,
  stored: StoredItem | null,
  pending: readonly OutboxRow[],
) => {
  const blocks = new Map(item.blocks.map((held) => [held.block.id, held]));
  const derived = deriveItem(item.fields, blocks);
  const lastWritten = Math.max(0, ...pending.map((row) => row.createdAt));
  return listingRowOf(
    item,
    uniqueTags(derived.tags.map((tag) => tag.tag)),
    Math.max(stored?.updatedAt ?? 0, lastWritten),
  );
};

// a save this device made of a page the library holds at another item, which the cell folds onto
// that item: no card of its own meanwhile
const foldsOnto = function* foldsOnto(id: string, pending: readonly OutboxRow[]): SqlPlan<boolean> {
  const [made] = pending;
  if (made === undefined || (made.op.kind !== "saveLink" && made.op.kind !== "save")) {
    return false;
  }
  const holder = yield* heldAtAddress(made.op.input.url);
  return holder !== null && holder !== id;
};

// the listing's row for each item asked, null for one no screen lists (purged, or never held)
export const readListingRows = function* readListingRows(
  itemIds: readonly string[],
  rows: readonly OutboxRow[],
): SqlPlan<Map<string, ReplicaListingRow | null>> {
  const answer = new Map<string, ReplicaListingRow | null>();
  const tags = yield* readTagsByItem(itemIds);
  for (const id of itemIds) {
    const pending = rowsNaming(rows, id);
    const stored = yield* readItem(id);
    if (stored?.kind === "purged") {
      answer.set(id, null);
      continue;
    }
    if (pending.length === 0) {
      answer.set(
        id,
        stored === null
          ? null
          : listingRowOf(
              {
                blocks: [],
                bodyHeld: true,
                card: stored.card,
                fields: stored.fields,
                id,
                parked: false,
                seq: stored.seq,
                unsent: false,
              },
              tags.get(id) ?? [],
              stored.updatedAt,
            ),
      );
      continue;
    }
    const item = yield* readReplicaItem(id, pending);
    answer.set(
      id,
      item === null || (stored === null && (yield* foldsOnto(id, pending)))
        ? null
        : laidListingRow(item, stored, pending),
    );
  }
  return answer;
};

// every row the listing holds: the items the replica holds, and the ones this device made that
// have not landed
export const readAllListingRows = function* readAllListingRows(
  rows: readonly OutboxRow[],
): SqlPlan<ReplicaListingRow[]> {
  const items = yield* readLiveItems();
  const tags = yield* readTagsByItem(null);
  const named = new Set(rows.flatMap((row) => itemIdsOf(row.op)));
  const listed: ReplicaListingRow[] = [];
  const held = new Set<string>();
  for (const stored of items) {
    if (stored.kind !== "live") {
      continue;
    }
    held.add(stored.id);
    if (named.has(stored.id)) {
      continue;
    }
    listed.push(
      listingRowOf(
        {
          blocks: [],
          bodyHeld: true,
          card: stored.card,
          fields: stored.fields,
          id: stored.id,
          parked: false,
          seq: stored.seq,
          unsent: false,
        },
        tags.get(stored.id) ?? [],
        stored.updatedAt,
      ),
    );
  }
  const laid = yield* readListingRows([...named], rows);
  for (const row of laid.values()) {
    if (row !== null) {
      listed.push(row);
    }
  }
  return listed;
};

type FolderOp = Extract<OutboxOp, { kind: "folders" }>["ops"][number];

// one op laid down as the cell lands it, which takes a deleted folder's subtree with it
const layFolderOp = (folders: Map<string, ListingFolder>, op: FolderOp): void => {
  switch (op.op) {
    case "create": {
      if (!folders.has(op.id)) {
        folders.set(op.id, { id: op.id, name: op.name, parentId: op.parentId, sort: op.sort });
      }
      return;
    }
    case "rename": {
      const folder = folders.get(op.id);
      if (folder !== undefined) {
        folders.set(op.id, { ...folder, name: op.name });
      }
      return;
    }
    case "move": {
      const folder = folders.get(op.id);
      if (folder !== undefined) {
        folders.set(op.id, { ...folder, parentId: op.parentId, sort: op.sort });
      }
      return;
    }
    case "delete": {
      // an array's iterator reads the entries pushed while it runs, so each folder's children follow
      const gone = [op.id];
      for (const id of gone) {
        folders.delete(id);
        gone.push(
          ...[...folders.values()]
            .filter((folder) => folder.parentId === id)
            .map((folder) => folder.id),
        );
      }
    }
    // no default
  }
};

// the folder tree as landed, with every unsent folder write laid over
export const layFolders = (
  landed: readonly ListingFolder[],
  rows: readonly OutboxRow[],
): ListingFolder[] => {
  const folders = new Map(landed.map((folder) => [folder.id, folder]));
  for (const row of rows) {
    if (row.op.kind === "folders") {
      for (const op of row.op.ops) {
        layFolderOp(folders, op);
      }
    }
  }
  return [...folders.values()];
};
