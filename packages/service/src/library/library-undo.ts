import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { changeSet, changeSetBody, changeSetItem, item, itemBody } from "@repo/db/library-schema";
import { and, asc, desc, eq, exists, gt, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";

import { dropEntries, ENTRY_COLUMNS, entryOf } from "./library-change-sets";
import { askFills } from "./library-fills";
import { landItem } from "./library-landing";
import type { LiveItemRow } from "./library-landing";
import { refuse } from "./library-refusal";
import type { LibraryRefusal, LibraryResult } from "./library-refusal";
import { STORED_ITEM_COLUMNS } from "./library-rows";
import type { StoredItem } from "./library-rows";
import { writeLibrary } from "./library-store";
import type { LibraryWriter, WriteScope } from "./library-store";
import { revertChangeSets } from "./revert-change";
import type { BodyEntry, HeldEntry } from "./revert-change";
import { anyOf } from "./set-sql";

const UNDO_TURNS_MAX = 50;
const UNDO_ENTRIES_MAX = BULK_ITEMS_MAX;

type UndoTarget =
  | { readonly threadId: string; readonly turn: number }
  | { readonly threadId: string; readonly before?: number | undefined };

const undoneSchema = z.object({
  kept: z.array(z.string()),
  next: z.number().nullable(),
  refused: z.array(z.string()),
  reverted: z.array(z.string()),
});

type Undone = z.output<typeof undoneSchema>;

interface SetWindow {
  readonly setId: string;
  readonly after: string | null;
}

const lotSchema = undoneSchema.extend({
  more: z.object({ after: z.string(), setId: z.string() }).nullable(),
});

type Lot = z.output<typeof lotSchema>;

const undoable = (db: DbExecutor, accountId: string, threadId: string) =>
  and(
    eq(changeSet.accountId, accountId),
    eq(changeSet.threadId, threadId),
    isNotNull(changeSet.sealedAt),
    exists(
      db
        .select({ id: changeSetItem.changeSetId })
        .from(changeSetItem)
        .where(
          and(
            eq(changeSetItem.accountId, changeSet.accountId),
            eq(changeSetItem.changeSetId, changeSet.id),
          ),
        ),
    ),
  );

const turnsOf = (target: UndoTarget) => {
  if ("turn" in target) {
    return eq(changeSet.turn, target.turn);
  }

  return target.before === undefined ? undefined : lt(changeSet.turn, target.before);
};

export const undoableTurns = async (db: DbExecutor, accountId: string, threadId: string) => {
  const rows = await db
    .select({ turn: changeSet.turn })
    .from(changeSet)
    .where(undoable(db, accountId, threadId))
    .orderBy(asc(changeSet.turn));

  return rows.map(({ turn }) => turn);
};

interface SetEntries {
  readonly id: string;
  readonly items: ReadonlyMap<string, HeldEntry>;
}

const entriesOf = async (
  scope: WriteScope,
  setIds: readonly string[],
  itemIds: readonly string[] | null,
) => {
  const { accountId, tx } = scope;

  const [fields, bodies] = await Promise.all([
    tx
      .select({
        ...ENTRY_COLUMNS,
        ...STORED_ITEM_COLUMNS,
        bodyVersion: itemBody.version,
        changeSetId: changeSetItem.changeSetId,
      })
      .from(changeSetItem)
      .innerJoin(
        item,
        and(eq(item.accountId, changeSetItem.accountId), eq(item.id, changeSetItem.itemId)),
      )
      .innerJoin(
        itemBody,
        and(eq(itemBody.accountId, changeSetItem.accountId), eq(itemBody.itemId, item.id)),
      )
      .where(
        and(
          eq(changeSetItem.accountId, accountId),
          anyOf(changeSetItem.changeSetId, setIds),
          itemIds === null ? undefined : anyOf(changeSetItem.itemId, itemIds),
        ),
      ),
    tx
      .select({
        blocksBefore: changeSetBody.blocksBefore,
        changeSetId: changeSetBody.changeSetId,
        itemId: changeSetBody.itemId,
        versionAfter: changeSetBody.versionAfter,
        versionBefore: changeSetBody.versionBefore,
      })
      .from(changeSetBody)
      .where(
        and(
          eq(changeSetBody.accountId, accountId),
          anyOf(changeSetBody.changeSetId, setIds),
          itemIds === null ? undefined : anyOf(changeSetBody.itemId, itemIds),
        ),
      ),
  ]);

  const bodyOf = new Map<string, BodyEntry>(
    bodies.map(({ changeSetId, itemId, ...body }) => [`${changeSetId}/${itemId}`, body]),
  );

  const rows = fields.map(({ bodyVersion, changeSetId, inverse, itemId, made, ...stored }) => ({
    changeSetId,
    held: {
      entry: {
        body: bodyOf.get(`${changeSetId}/${itemId}`) ?? null,
        fields: entryOf({ inverse, made }),
      },
      now: { bodyVersion, fields: stored.fields },
    },
    stored,
  }));

  const sets = setIds.map(
    (id) =>
      ({
        id,
        items: new Map(
          rows
            .filter((row) => row.changeSetId === id)
            .map(({ held, stored }) => [stored.id, held] satisfies [string, HeldEntry]),
        ),
      }) satisfies SetEntries,
  );

  return {
    items: new Map<string, StoredItem>(rows.map(({ stored }) => [stored.id, stored])),
    sets,
  };
};

const pickSets = async (scope: WriteScope, target: UndoTarget) => {
  const { accountId, tx } = scope;

  const waiting = await tx
    .select({
      entries: tx.$count(
        changeSetItem,
        and(
          eq(changeSetItem.accountId, changeSet.accountId),
          eq(changeSetItem.changeSetId, changeSet.id),
        ),
      ),
      id: changeSet.id,
      turn: changeSet.turn,
    })
    .from(changeSet)
    .where(and(undoable(tx, accountId, target.threadId), turnsOf(target)))
    .orderBy(desc(changeSet.turn))
    .limit(UNDO_TURNS_MAX + 1);

  const sets: typeof waiting = [];
  let entries = 0;

  for (const set of waiting.slice(0, UNDO_TURNS_MAX)) {
    if (sets.length > 0 && entries + set.entries > UNDO_ENTRIES_MAX) {
      break;
    }

    sets.push(set);
    entries += set.entries;
  }

  return {
    next: waiting.length > sets.length ? (sets.at(-1)?.turn ?? null) : null,
    setIds: sets.map((set) => set.id),
  };
};

const windowOf = async (scope: WriteScope, { after, setId }: SetWindow) => {
  const { accountId, tx } = scope;

  const rows = await tx
    .select({ itemId: changeSetItem.itemId })
    .from(changeSetItem)
    .where(
      and(
        eq(changeSetItem.accountId, accountId),
        eq(changeSetItem.changeSetId, setId),
        after === null ? undefined : gt(changeSetItem.itemId, after),
      ),
    )
    .orderBy(asc(changeSetItem.itemId))
    .limit(UNDO_ENTRIES_MAX + 1);

  const itemIds = rows.slice(0, UNDO_ENTRIES_MAX).map(({ itemId }) => itemId);
  const last = itemIds.at(-1);

  return {
    itemIds,
    more: rows.length > UNDO_ENTRIES_MAX && last !== undefined ? { after: last, setId } : null,
  };
};

const undoLot = async (
  scope: WriteScope,
  target: UndoTarget,
  window: SetWindow | null,
  refuseHeldBack: boolean,
) => {
  const { next, setIds } =
    window === null ? await pickSets(scope, target) : { next: null, setIds: [window.setId] };

  const [only] = setIds;

  const cut =
    setIds.length === 1 && only !== undefined
      ? await windowOf(scope, window ?? { after: null, setId: only })
      : { itemIds: null, more: null };

  const { items, sets } = await entriesOf(scope, setIds, cut.itemIds);
  const verdict = revertChangeSets({ at: scope.now, sets });
  const reverted: LiveItemRow[] = [];
  const refused = new Map<string, LibraryRefusal>();

  for (const [itemId, before] of items) {
    const back = verdict.items.get(itemId);

    if (back !== undefined) {
      const landed = await scope.attempt(
        async (part) =>
          await landItem(part, { before, body: back.blocks, fields: back.fields, itemId }),
      );

      if (landed.ok) {
        reverted.push(landed.value);
      } else {
        refused.set(itemId, landed.refusal);
      }
    }
  }

  const [first] = refused.values();

  if (first !== undefined && reverted.length === 0 && refuseHeldBack) {
    refuse(first);
  }

  await askFills(scope, reverted);
  const keptIds = new Set(verdict.kept.map((kept) => `${kept.setId}/${kept.itemId}`));
  await dropEntries(
    scope,
    sets.map((set) => ({
      changeSetId: set.id,
      itemIds: [...set.items.keys()].filter(
        (itemId) => !keptIds.has(`${set.id}/${itemId}`) && !refused.has(itemId),
      ),
    })),
  );

  return {
    kept: [...new Set(verdict.kept.map((kept) => kept.itemId))]
      .filter((id) => !refused.has(id))
      .toSorted(),
    more: cut.more,
    next,
    refused: [...refused.keys()].toSorted(),
    reverted: reverted.map((row) => row.id).toSorted(),
  } satisfies z.input<typeof lotSchema>;
};

export const undoTurns = async (writer: LibraryWriter, target: UndoTarget) => {
  const land = async (window: SetWindow | null, refuseHeldBack: boolean) =>
    await writeLibrary(
      writer,
      { answer: lotSchema, opId: undefined },
      async (scope) => await undoLot(scope, target, window, refuseHeldBack),
    );

  const first = await land(null, true);

  if (!first.ok) {
    return first;
  }

  const lots: Lot[] = [first.value];

  for (let lot: Lot = first.value; lot.more !== null;) {
    const landed = await land(
      lot.more,
      lots.every(({ reverted }) => reverted.length === 0),
    );

    if (!landed.ok) {
      return landed;
    }

    lot = landed.value;
    lots.push(lot);
  }

  const all = (pick: (lot: Undone) => readonly string[]) =>
    [...new Set(lots.flatMap(pick))].toSorted();

  return {
    ok: true,
    value: {
      kept: all((lot) => lot.kept),
      next: first.value.next,
      refused: all((lot) => lot.refused),
      reverted: all((lot) => lot.reverted),
    },
  } satisfies LibraryResult<Undone>;
};
