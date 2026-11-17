// The library's item writes beyond a device's property ops, each landed inside one write's
// transaction by the rules every write meets (`./library-landing`): a note or a file made whole, an
// item's fields as a bulk organize, Deleted and back, and Deleted emptied.

import { organized } from "@repo/contract/library/cell-rules";
import type { OrganizeInput } from "@repo/contract/library/cell-rules";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { fileFields } from "@repo/contract/library/item-makes";
import { itemListing, itemSummary } from "@repo/contract/library/library-index";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { itemSummarySchema } from "@repo/contract/library/library-wire";
import { item, purgedItem } from "@repo/db/library-schema";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import { dropItemFiles, fileOf } from "../files/file-names";
import { folderOfTarget } from "./library-folders";
import { landItem } from "./library-landing";
import type { LiveItemRow } from "./library-landing";
import { refuse, RefusedWriteError } from "./library-refusal";
import { idTaken, readItem, tagsOf } from "./library-rows";
import type { WriteScope } from "./library-store";
import { landFields } from "./library-writes";

export interface NewItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  // its body in reading order
  readonly blocks: readonly BodyBlock[];
}

// an item the write makes, with its body; an id the library made already is a conflict
export const landNew = async (scope: WriteScope, made: NewItem): Promise<LiveItemRow> => {
  if (await idTaken(scope.tx, scope.accountId, made.id)) {
    refuse({ kind: "conflict" });
  }
  return await landItem(scope, {
    before: null,
    body: made.blocks,
    fields: made.fields,
    itemId: made.id,
  });
};

export interface CreateFileInput {
  readonly id: string;
  readonly sha: string;
  readonly name: string;
  readonly title?: string | undefined;
  readonly tags: readonly string[];
  readonly folderId: string | null;
  readonly savedAt: number;
}

// a file whose bytes the library holds
export const createFile = async (
  scope: WriteScope,
  input: CreateFileInput,
): Promise<LiveItemRow> => {
  const held = await fileOf(scope.tx, scope.accountId, input.sha);
  if (held === null) {
    return refuse({ kind: "blob-missing", shas: [input.sha] });
  }
  return await landNew(scope, {
    blocks: [],
    fields: fileFields({ ...input, mime: held.mime }),
    id: input.id,
  });
};

// tags, folder, pin and title for each item; an id that names no item refuses the whole change
export const organizeItems = async (
  scope: WriteScope,
  input: OrganizeInput,
): Promise<LiveItemRow[]> => {
  const folderId = await folderOfTarget(scope, input.folder);
  const landed: LiveItemRow[] = [];
  for (const itemId of new Set(input.ids)) {
    const held = await readItem(scope.tx, scope.accountId, itemId);
    if (held === null) {
      return refuse({ kind: "not-found" });
    }
    landed.push(await landFields(scope, held, organized(held.fields, input, folderId, scope.now)));
  }
  return landed;
};

// the items a write landed as a list names them, each with every tag it carries as the write left
// it, so an organize and a list answer one spelling of an item
export const landedSummaries = async (
  scope: WriteScope,
  rows: readonly LiveItemRow[],
): Promise<z.infer<typeof itemSummarySchema>[]> => {
  const tags = await tagsOf(
    scope.tx,
    scope.accountId,
    rows.map(({ id }) => id),
  );
  return rows.map((row) => itemSummary(itemListing(row, tags.get(row.id) ?? [])));
};

export interface BulkAnswer {
  readonly changed: string[];
  readonly missing: string[];
  // left in Deleted, each address another live item's now
  readonly addressHeld: string[];
}

// to Deleted, or back: an item already where it is asked to be counts as changed, and an id naming
// no item as missing
export const setDeleted = async (
  scope: WriteScope,
  input: { readonly ids: readonly string[]; readonly deleted: boolean },
): Promise<BulkAnswer> => {
  const changed: string[] = [];
  const missing: string[] = [];
  const addressHeld: string[] = [];
  for (const itemId of new Set(input.ids)) {
    const held = await readItem(scope.tx, scope.accountId, itemId);
    if (held === null) {
      missing.push(itemId);
    } else if ((held.fields.deletedAt !== null) === input.deleted) {
      changed.push(itemId);
    } else {
      try {
        await landFields(scope, held, {
          ...held.fields,
          deletedAt: input.deleted ? scope.now : null,
        });
        changed.push(itemId);
      } catch (error) {
        // refused before anything of the item was written: its address is another live item's
        if (!(error instanceof RefusedWriteError) || error.refusal.kind !== "url-held") {
          throw error;
        }
        addressHeld.push(itemId);
      }
    }
  }
  return { addressHeld, changed, missing };
};

// Deleted emptied of `ids`: each item goes with every row it holds, its change sets' entries
// included, its id kept as purged and its files touched, so each one nothing else names goes a day
// later. It joins no set, since nothing can take it back; an id naming no item in Deleted is missing
export const purgeItems = async (scope: WriteScope, ids: readonly string[]) => {
  const { accountId, now, tx } = scope;
  const purged: string[] = [];
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const held = await readItem(tx, accountId, id);
    if (held === null || held.fields.deletedAt === null) {
      missing.push(id);
    } else {
      await dropItemFiles(tx, accountId, id, now);
      await tx.delete(item).where(and(eq(item.accountId, accountId), eq(item.id, id)));
      await tx.insert(purgedItem).values({ accountId, id, seq: await scope.seq() });
      purged.push(id);
    }
  }
  return { missing, purged };
};
