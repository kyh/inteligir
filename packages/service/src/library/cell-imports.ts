// An import as the cell takes it: the device reads the file (`apps/web/src/library/import`) and asks
// how each note it planned stands, which of the files it uploaded the landed items name, and lands
// its items a batch at a time. Each item lands whole or not at all inside its batch, so one a rule
// refuses leaves the rest.

import type { IMPORT_STANDINGS } from "@repo/contract/library/library-wire";
import type { importedItemSchema } from "@repo/contract/library/library-contract";
import { urlKey } from "@repo/contract/items/item-url";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";

import { itemBlobs, items } from "@repo/db/cell/schema";
import type { CellActor } from "./cell-actor";
import { listChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import { askFill } from "./cell-fills";
import { folderOfTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { landNew, setDeleted } from "./cell-items";
import { urlHolder } from "./cell-landing";
import type { LandingScope } from "./cell-landing";
import { refuse } from "./cell-refusal";
import { readItem } from "./library-queries";

type ImportedItem = z.infer<typeof importedItemSchema>;

interface NoteStanding {
  readonly id: string;
  readonly standing: (typeof IMPORT_STANDINGS)[number];
}

export const IMPORT_ACTOR: CellActor = { kind: "import" };

const heldByUrl = (db: CellDb, url: string | null): { readonly id: string } | null => {
  const key = url === null ? null : urlKey(url);
  return key === null ? null : urlHolder(db, key, null);
};

// A note as it stands: one whose id or address a live item holds is that item (`held`); one whose
// id an item in Deleted holds is that item, to come back as it stands (`deleted`), since one id
// names one item and a fresh copy would leave its twin in Deleted; and one whose id a purged item
// kept takes a fresh id (`new`), since the library never makes an id again
export const settleNote = (
  db: CellDb,
  note: { readonly id: string; readonly url: string | null },
  newId: () => string,
): NoteStanding => {
  const item = readItem(db, note.id);
  if (item?.kind === "live" && item.fields.deletedAt === null) {
    return { id: note.id, standing: "held" };
  }
  const holder = heldByUrl(db, note.url);
  if (holder !== null) {
    return { id: holder.id, standing: "held" };
  }
  if (item?.kind === "live") {
    return { id: note.id, standing: "deleted" };
  }
  return { id: item === null ? note.id : newId(), standing: "new" };
};

// which of the files a live item names, and which of them an item holds as its own original
export const namedFiles = (db: CellDb, shas: readonly string[]) => {
  const rows = listChunks(shas, 1).flatMap((chunk) =>
    db
      .selectDistinct({ originalSha: items.originalSha, sha256: itemBlobs.sha256 })
      .from(itemBlobs)
      .innerJoin(items, eq(items.id, itemBlobs.itemId))
      .where(and(isNull(items.deletedAt), eq(items.purged, 0), inArray(itemBlobs.sha256, chunk)))
      .all(),
  );
  return {
    named: [...new Set(rows.map((row) => row.sha256))],
    originals: [
      ...new Set(rows.flatMap((row) => (row.originalSha === row.sha256 ? [row.sha256] : []))),
    ],
  };
};

const landItem = (scope: LandingScope, ids: CellIds, item: ImportedItem): "added" | "held" => {
  if (item.kind === "restore") {
    const restored = setDeleted(scope, { deleted: false, ids: [item.id] });
    for (const landed of restored.landed) {
      askFill(scope, landed);
    }
    return restored.landed.length > 0 ? "added" : "held";
  }
  if (
    readItem(scope.db, item.id)?.kind === "live" ||
    heldByUrl(scope.db, item.fields.url) !== null
  ) {
    return "held";
  }
  const folderId =
    item.folder === null ? null : folderOfTarget(scope, { path: item.folder }, ids.item);
  const landed = landNew(scope, {
    blocks: item.blocks,
    fields: { ...item.fields, deletedAt: null, folderId: folderId ?? null },
    id: item.id,
  });
  askFill(scope, landed, item.cover);
  return "added";
};

// a batch, each item apart: a library too full for one refuses the whole batch, since the import
// stops there, and any other refusal leaves that item out as unreadable
export const landImported = (scope: LandingScope, ids: CellIds, batch: readonly ImportedItem[]) => {
  const counts = { added: 0, alreadySaved: 0, unreadable: 0 };
  for (const item of batch) {
    const landed = scope.attempt(() => landItem(scope, ids, item));
    if (landed.ok) {
      counts[landed.value === "added" ? "added" : "alreadySaved"] += 1;
    } else if (landed.refusal.kind === "quota") {
      refuse(landed.refusal);
    } else {
      counts.unreadable += 1;
    }
  }
  return counts;
};
