import { canonicalJson } from "@repo/contract/library/canonical-json";
import { organized } from "@repo/contract/library/cell-rules";
import { deriveItem } from "@repo/contract/library/derive-item";
import type { DerivedItem } from "@repo/contract/library/derive-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { sweptSchema } from "@repo/contract/library/library-wire";
import type { sweepVerbSchema } from "@repo/contract/rpc/library-contract";
import { item, itemBody, itemSearch, itemTag } from "@repo/db/library-schema";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { JobRun } from "../jobs/job-kinds";
import { searchVectorOf } from "../search/search-vector";
import { folderOfTarget } from "./library-folders";
import { mintLibraryId } from "./library-ids";
import { purgeItems, restoreDeleted } from "./library-items";
import { sweptItems } from "./library-listing";
import { STORED_ITEM_COLUMNS, tagRowsOf } from "./library-rows";
import { writeLibrary } from "./library-store";
import type { WriteScope } from "./library-store";
import { anyOf, chunksOf, textArray } from "./set-sql";

const SWEEP_LOT = 1000;
const TAG_CHUNK = 500;

type SweepVerb = z.infer<typeof sweepVerbSchema>;

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

const toDeleted = async (scope: WriteScope, ids: readonly string[]) => {
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

const pinnedAtOf = (pinned: boolean | undefined, now: number) => {
  if (pinned === undefined) {
    return;
  }

  return pinned ? sql`coalesce(${item.pinnedAt}, ${now})` : null;
};

const pinMoves = (pinned: boolean | undefined) => {
  if (pinned === undefined) {
    return;
  }

  return pinned ? isNull(item.pinnedAt) : isNotNull(item.pinnedAt);
};

const place = async (
  scope: WriteScope,
  ids: readonly string[],
  folderId: string | null | undefined,
  pinned: boolean | undefined,
) => {
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

interface Retagged {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly derived: DerivedItem;
  readonly text: string;
}

const writeTags = async (scope: WriteScope, landed: readonly Retagged[]) => {
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

const retag = async (scope: WriteScope, ids: readonly string[], change: TagChange) => {
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

    const landed = rows.flatMap((row) => {
      const fields = organized(row.fields, { ...change, ids: [] }, undefined, now);

      if (canonicalJson(fields) === canonicalJson(row.fields)) {
        return [] satisfies Retagged[];
      }

      if (!libraryItemFieldsSchema.validate(fields)) {
        refused.push(row.id);

        return [] satisfies Retagged[];
      }

      return [
        { derived: deriveItem(fields, row.digest), fields, id: row.id, text: row.text },
      ] satisfies Retagged[];
    });

    if (landed.length > 0) {
      await writeTags(scope, landed);
    }
  }

  return refused.toSorted();
};

const askLots = async (scope: WriteScope, ids: readonly string[], change: TagChange) => {
  const sweep = mintLibraryId(scope.now);
  await scope.askJobs(
    chunksOf(ids, SWEEP_LOT).map((lot, at) => ({
      id: `sweep:${sweep}:${String(at)}`,
      kind: "sweep" as const,
      payload: { ...change, ids: lot },
    })),
  );
};

const organizeSwept = async (
  scope: WriteScope,
  ids: readonly string[],
  verb: Extract<SweepVerb, { kind: "organize" }>,
) => {
  const { addTags, folder, pinned, removeTags } = verb;
  await place(scope, ids, await folderOfTarget(scope, folder), pinned);

  if (addTags === undefined && removeTags === undefined) {
    return [] satisfies string[];
  }

  if (ids.length > SWEEP_LOT) {
    await askLots(scope, ids, { addTags, removeTags });

    return [] satisfies string[];
  }

  return await retag(scope, ids, { addTags, removeTags });
};

export const sweepItems = async (
  scope: WriteScope,
  swept: z.output<typeof sweptSchema>,
  verb: SweepVerb,
) => {
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
      const restored = await restoreDeleted(scope, inDeleted);

      return answer(inDeleted.filter((id) => !restored.has(id)).toSorted());
    }

    case "purge": {
      await purgeItems(scope, inDeleted);

      return answer([]);
    }

    case "organize": {
      return answer(await organizeSwept(scope, ids, verb));
    }

    default: {
      throw new Error(`unexpected ${String(verb satisfies never)}`);
    }
  }
};

export const SWEEP_RUN: JobRun<z.output<typeof sweepLotSchema>> = {
  payload: sweepLotSchema,
  run: async (lot, { accountId }) => {
    const landed = await writeLibrary(
      { accountId, actor: { kind: "person" } },
      { answer: z.array(z.string()), opId: undefined },
      async (scope) => await retag(scope, lot.ids, lot),
    );

    return !landed.ok && landed.refusal.kind === "busy" ? "retry" : "done";
  },
  tries: { kind: "until-done" },
};
