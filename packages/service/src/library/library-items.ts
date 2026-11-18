// The library's item writes beyond a device's property ops, each landed inside one write's
// transaction by the rules every write meets (`./library-landing`): a note or a file made whole, an
// item's fields as a bulk organize, Deleted and back, and Deleted emptied.

import { organized } from "@repo/contract/library/cell-rules";
import type { FolderTarget, OrganizeInput } from "@repo/contract/library/cell-rules";
import { fileFields, noteFields } from "@repo/contract/library/item-makes";
import { withReading } from "@repo/contract/library/item-reading";
import { itemListing, itemSummary } from "@repo/contract/library/library-index";
import type { itemSummarySchema } from "@repo/contract/library/library-wire";
import { item, purgedItem } from "@repo/db/library-schema";
import { and, eq, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import { dropItemFiles, fileOf } from "../files/file-names";
import { stampEntryThreads } from "./library-change-sets";
import { noteBlocksOf } from "./library-codec";
import { askFills } from "./library-fills";
import { folderOfTarget } from "./library-folders";
import { mintLibraryId } from "./library-ids";
import { landNewItems } from "./library-landing";
import type { LiveItemRow, NewItem } from "./library-landing";
import { refuse, RefusedWriteError } from "./library-refusal";
import { readItem, tagsOf } from "./library-rows";
import type { WriteScope } from "./library-store";
import { landFields } from "./library-writes";
import { anyOf } from "./set-sql";

// an item the write makes, with its body; an id the library made already is a conflict
export const landNew = async (scope: WriteScope, made: NewItem): Promise<LiveItemRow> => {
  const [landed] = await landNewItems(scope, [made]);
  if (landed === undefined) {
    throw new Error("a landing of one item answered none");
  }
  return landed.ok ? landed.value : refuse(landed.refusal);
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

export interface CreateNoteInput {
  readonly markdown: string;
  readonly folder?: FolderTarget | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly title?: string | undefined;
}

// a note written as markdown, as an agent writes one: filed by the folder's id or path, a path's
// missing folders made, and saved now
export const createNote = async (
  scope: WriteScope,
  input: CreateNoteInput,
): Promise<LiveItemRow> => {
  const folderId = await folderOfTarget(scope, input.folder);
  return await landNew(scope, {
    blocks: await noteBlocksOf(scope, input.markdown),
    fields: noteFields({
      folderId: folderId ?? null,
      savedAt: scope.now,
      tags: input.tags ?? [],
      title: input.title ?? "",
    }),
    id: mintLibraryId(scope.now),
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
// no item as missing. A link back from Deleted still waiting for its page asks for it again
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
        const landed = await landFields(scope, held, {
          ...held.fields,
          deletedAt: input.deleted ? scope.now : null,
        });
        await askFills(scope, [landed]);
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

// a link's page read again: it waits, pending, as a link saved to read later does, and the reading
// replaces only its article; an item with no address has no page to read
export const refreshItem = async (scope: WriteScope, itemId: string): Promise<LiveItemRow> => {
  const held = await readItem(scope.tx, scope.accountId, itemId);
  if (held === null || held.fields.url === null) {
    return refuse({ kind: "not-found" });
  }
  const landed = await landFields(scope, held, withReading(held.fields, { kind: "asked" }));
  await askFills(scope, [landed]);
  return landed;
};

// Back from Deleted in a statement, each of `ids` in Deleted but a link whose address a live item
// holds; of several in Deleted at one address only the one deleted last comes back, as the address
// takes one live item. A link still waiting for its page asks for it again. Answers those it brought
// back
export const restoreDeleted = async (
  scope: WriteScope,
  ids: readonly string[],
): Promise<Set<string>> => {
  if (ids.length === 0) {
    return new Set();
  }
  const { accountId, now, tx } = scope;
  const ranked = tx
    .select({
      id: item.id,
      rank: sql<number>`row_number() over (partition by ${item.urlKey} order by ${item.deletedAt} desc, ${item.id} collate "C")`.as(
        "rank",
      ),
      urlKey: item.urlKey,
    })
    .from(item)
    .where(and(eq(item.accountId, accountId), isNotNull(item.deletedAt), anyOf(item.id, ids)))
    .as("ranked");
  const live = alias(item, "live");
  const free = await tx
    .select({ id: ranked.id })
    .from(ranked)
    .where(
      or(
        isNull(ranked.urlKey),
        and(
          eq(ranked.rank, 1),
          notExists(
            tx
              .select({ held: sql`1` })
              .from(live)
              .where(
                and(
                  eq(live.accountId, accountId),
                  eq(live.urlKey, ranked.urlKey),
                  isNull(live.deletedAt),
                ),
              ),
          ),
        ),
      ),
    );
  const restored = new Set(free.map((row) => row.id));
  if (restored.size > 0) {
    const seq = await scope.seq();
    const back = await tx
      .update(item)
      .set({ deletedAt: null, seq, updatedAt: now })
      .where(and(eq(item.accountId, accountId), anyOf(item.id, [...restored])))
      .returning({ id: item.id, reading: item.reading, url: item.url });
    await askFills(
      scope,
      back.map(({ id, reading, url }) => ({ fields: { deletedAt: null, reading, url }, id })),
    );
  }
  return restored;
};

// Deleted emptied of `ids`, in a statement a table: each item goes with every row it holds, its
// change sets' entries included and their threads stamped, its id kept as purged and its files
// touched, so each one nothing else names goes a day later. It joins no set, since nothing can take
// it back; an id naming no item in Deleted is missing
export const purgeItems = async (scope: WriteScope, ids: readonly string[]) => {
  const { accountId, now, tx } = scope;
  const unique = [...new Set(ids)];
  const inDeleted = and(
    eq(item.accountId, accountId),
    isNotNull(item.deletedAt),
    anyOf(item.id, unique),
  );
  const rows = await tx.select({ id: item.id }).from(item).where(inDeleted);
  const held = new Set(rows.map((row) => row.id));
  if (held.size > 0) {
    const seq = await scope.seq();
    await stampEntryThreads(scope, [...held], seq);
    await dropItemFiles(tx, accountId, [...held], now);
    await tx.insert(purgedItem).select(
      tx
        .select({
          accountId: item.accountId,
          id: item.id,
          seq: sql<number>`${seq}::bigint`.as("seq"),
        })
        .from(item)
        .where(inDeleted),
    );
    await tx.delete(item).where(inDeleted);
  }
  return {
    missing: unique.filter((id) => !held.has(id)),
    purged: unique.filter((id) => held.has(id)),
  };
};
