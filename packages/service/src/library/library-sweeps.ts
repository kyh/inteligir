// A sweep: a verb a person asks over every item a scope lists (`library.items.sweep`), which a
// device that read only some of the scope's pages cannot name by id. It lands in the one write as
// set statements: to Deleted, back from it, out of it for good, into a folder or a pin, each one
// statement over every item it takes, and a change of tags a chunk at a time, deriving each item's
// tags and search row again in JS. A change of tags over SWEEP_LOT items would hold the account's
// lock past every other write's wait, so it goes to lots, each a write of its own after the answer
// (`landSweepLot`). Only the apps ask one, on a person's press, so a sweep joins no change set.

import { canonicalJson } from "@repo/contract/library/canonical-json";
import { organized } from "@repo/contract/library/cell-rules";
import { deriveItem } from "@repo/contract/library/derive-item";
import type { DerivedItem } from "@repo/contract/library/derive-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { sweptSchema } from "@repo/contract/library/library-wire";
import type { sweepVerbSchema } from "@repo/contract/rpc/library-contract";
import { item, itemBody, itemSearch, itemTag, job } from "@repo/db/library-schema";
import { and, eq, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { searchVectorOf } from "../search/search-vector";
import { askFills } from "./library-fills";
import { folderOfTarget } from "./library-folders";
import { mintLibraryId } from "./library-ids";
import { purgeItems } from "./library-items";
import { sweptItems } from "./library-listing";
import { STORED_ITEM_COLUMNS, tagRowsOf } from "./library-rows";
import type { WriteScope } from "./library-store";
import { anyOf, chunksOf, textArray } from "./set-sql";

// the most items a change of tags lands in one write: about 4 s under the lock, measured at 5,000
const SWEEP_LOT = 5000;
// the items a change of tags reads and writes a statement at a time
const TAG_CHUNK = 500;

type SweepVerb = z.infer<typeof sweepVerbSchema>;

// a lot of a change of tags, as its `sweep` job carries it
export const sweepLotSchema = z.object({
  addTags: z.array(z.string()).optional(),
  ids: z.array(z.string()),
  removeTags: z.array(z.string()).optional(),
});

type TagChange = Omit<z.infer<typeof sweepLotSchema>, "ids">;

export const sweptAnswerSchema = z.object({
  items: z.number(),
  refused: z.array(z.string()),
});

const toDeleted = async (scope: WriteScope, ids: readonly string[]): Promise<void> => {
  if (ids.length === 0) {
    return;
  }
  const { accountId, now, tx } = scope;
  const seq = await scope.seq();
  await tx
    .update(item)
    .set({ deletedAt: now, seq, updatedAt: now })
    .where(and(eq(item.accountId, accountId), anyOf(item.id, ids)));
};

// Back from Deleted, each but a link whose address a live item holds; of several in Deleted at one
// address only the one deleted last comes back, as the address takes one live item. A link still
// waiting for its page asks for it again. Answers those left in Deleted
const restore = async (scope: WriteScope, ids: readonly string[]): Promise<string[]> => {
  if (ids.length === 0) {
    return [];
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
  return ids.filter((id) => !restored.has(id)).toSorted();
};

// the pin an item takes: kept as it was when it is already pinned, or when undefined
const pinnedAtOf = (pinned: boolean | undefined, now: number): SQL | null | undefined => {
  if (pinned === undefined) {
    return;
  }
  return pinned ? sql`coalesce(${item.pinnedAt}, ${now})` : null;
};

const pinMoves = (pinned: boolean | undefined): SQL | undefined => {
  if (pinned === undefined) {
    return;
  }
  return pinned ? isNull(item.pinnedAt) : isNotNull(item.pinnedAt);
};

// Into a folder, null for none, and pinned or not, each left as it is when undefined; drizzle's
// update leaves out a column set to undefined
const place = async (
  scope: WriteScope,
  ids: readonly string[],
  folderId: string | null | undefined,
  pinned: boolean | undefined,
): Promise<void> => {
  const { accountId, now, tx } = scope;
  const moves = or(
    folderId === undefined ? undefined : sql`${item.folderId} is distinct from ${folderId}`,
    pinMoves(pinned),
  );
  if (moves === undefined) {
    return;
  }
  const moving = and(eq(item.accountId, accountId), anyOf(item.id, ids), moves);
  const any = await tx.select({ id: item.id }).from(item).where(moving).limit(1);
  if (any.length === 0) {
    return;
  }
  const seq = await scope.seq();
  await tx
    .update(item)
    .set({ folderId, pinnedAt: pinnedAtOf(pinned, now), seq, updatedAt: now })
    .where(moving);
};

// an item a change of tags moves, with what its fields and body derive once it lands
interface Retagged {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly derived: DerivedItem;
  readonly text: string;
}

// each item's tags field, its tag rows from it and its search row, a statement a table; its card
// and its body's own tags stay as they are
const writeTags = async (scope: WriteScope, landed: readonly Retagged[]): Promise<void> => {
  const { accountId, now, tx } = scope;
  const seq = await scope.seq();
  const ids = landed.map(({ id }) => id);
  await tx
    .update(item)
    .set({ seq, tags: sql`retagged.tags::jsonb`, updatedAt: now })
    .from(
      sql`unnest(${textArray(ids)}, ${textArray(landed.map(({ fields }) => JSON.stringify(fields.tags)))}) as retagged(id, tags)`,
    )
    .where(and(eq(item.accountId, accountId), sql`${item.id} = retagged.id`));
  await tx
    .update(itemSearch)
    .set({ vec: sql`retagged.vec::tsvector` })
    .from(
      sql`unnest(${textArray(ids)}, ${textArray(
        landed.map(({ derived, text }) => searchVectorOf({ ...derived.search, body: text })),
      )}) as retagged(id, vec)`,
    )
    .where(and(eq(itemSearch.accountId, accountId), sql`${itemSearch.itemId} = retagged.id`));
  await tx
    .delete(itemTag)
    .where(
      and(
        eq(itemTag.accountId, accountId),
        eq(itemTag.origin, "field"),
        anyOf(itemTag.itemId, ids),
      ),
    );
  const tags = landed.flatMap(({ derived, id }) =>
    tagRowsOf(
      accountId,
      id,
      derived.tags.filter((tag) => tag.origin === "field"),
    ),
  );
  for (const chunk of chunksOf(tags, 1000)) {
    await tx.insert(itemTag).values(chunk).onConflictDoNothing();
  }
};

// The change of tags over the items still held, a chunk at a time; answers those past the tags'
// cap, which it leaves as they were
const retag = async (
  scope: WriteScope,
  ids: readonly string[],
  change: TagChange,
): Promise<string[]> => {
  const { accountId, now, tx } = scope;
  const refused: string[] = [];
  for (const chunk of chunksOf(ids, TAG_CHUNK)) {
    const rows = await tx
      .select({ ...STORED_ITEM_COLUMNS, digest: itemBody.digest, text: itemSearch.text })
      .from(item)
      .innerJoin(
        itemBody,
        and(eq(itemBody.accountId, item.accountId), eq(itemBody.itemId, item.id)),
      )
      .innerJoin(
        itemSearch,
        and(eq(itemSearch.accountId, item.accountId), eq(itemSearch.itemId, item.id)),
      )
      .where(and(eq(item.accountId, accountId), anyOf(item.id, chunk)));
    const landed = rows.flatMap((row): Retagged[] => {
      const fields = organized(row.fields, { ...change, ids: [] }, undefined, now);
      if (canonicalJson(fields) === canonicalJson(row.fields)) {
        return [];
      }
      if (!libraryItemFieldsSchema.validate(fields)) {
        refused.push(row.id);
        return [];
      }
      return [{ derived: deriveItem(fields, row.digest), fields, id: row.id, text: row.text }];
    });
    if (landed.length > 0) {
      await writeTags(scope, landed);
    }
  }
  return refused.toSorted();
};

// a change of tags too large for one write, left as lots its jobs land after the answer
const askLots = async (
  scope: WriteScope,
  ids: readonly string[],
  change: TagChange,
): Promise<void> => {
  const { accountId, now, tx } = scope;
  const sweep = mintLibraryId(now);
  const lots = chunksOf(ids, SWEEP_LOT).map((lot, at) => ({
    accountId,
    createdAt: now,
    id: `sweep:${sweep}:${String(at)}`,
    kind: "sweep" as const,
    payload: { ...change, ids: lot },
    runAt: now,
  }));
  await tx.insert(job).values(lots);
};

const organizeSwept = async (
  scope: WriteScope,
  ids: readonly string[],
  verb: Extract<SweepVerb, { kind: "organize" }>,
): Promise<string[]> => {
  const { addTags, folder, pinned, removeTags } = verb;
  await place(scope, ids, await folderOfTarget(scope, folder), pinned);
  if (addTags === undefined && removeTags === undefined) {
    return [];
  }
  if (ids.length > SWEEP_LOT) {
    await askLots(scope, ids, { addTags, removeTags });
    return [];
  }
  return await retag(scope, ids, { addTags, removeTags });
};

// The verb over the items the scope lists, as the write takes them: how many it took, and those a
// rule left as they were
export const sweepItems = async (
  scope: WriteScope,
  swept: z.output<typeof sweptSchema>,
  verb: SweepVerb,
): Promise<z.input<typeof sweptAnswerSchema>> => {
  const items = await sweptItems(scope.tx, scope.accountId, swept);
  const ids = items.map(({ id }) => id);
  const inDeleted = items.flatMap(({ deleted, id }) => (deleted ? [id] : []));
  const answer = (refused: readonly string[]) => ({ items: ids.length, refused: [...refused] });
  if (ids.length === 0) {
    return answer([]);
  }
  switch (verb.kind) {
    case "delete": {
      await toDeleted(
        scope,
        items.flatMap(({ deleted, id }) => (deleted ? [] : [id])),
      );
      return answer([]);
    }
    case "restore": {
      return answer(await restore(scope, inDeleted));
    }
    case "purge": {
      await purgeItems(scope, inDeleted);
      return answer([]);
    }
    case "organize": {
      return answer(await organizeSwept(scope, ids, verb));
    }
    // no default
  }
};

// one lot of a change of tags, landed as a write of its own: an item gone since the ask is passed
// over, and those past the tags' cap are answered, left as they were
export const landSweepLot = async (
  scope: WriteScope,
  lot: z.output<typeof sweepLotSchema>,
): Promise<string[]> => await retag(scope, lot.ids, lot);
