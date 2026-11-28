import { organized } from "@repo/contract/library/cell-rules";
import type { OrganizeInput, ParentTarget } from "@repo/contract/library/cell-rules";
import { fileFields, noteFields } from "@repo/contract/library/item-makes";
import { withReading } from "@repo/contract/library/item-reading";
import { sameJson } from "@repo/contract/library/canonical-json";
import { shownFileSha } from "@repo/contract/library/library-item";
import type { ListSettings } from "@repo/contract/library/library-item";
import { NEW_LIST, renamedProperties } from "@repo/contract/library/list-settings";
import type { PropertyRename } from "@repo/contract/library/list-settings";
import { itemListing, itemSummary } from "@repo/contract/library/library-index";
import { item, purgedItem } from "@repo/db/library-schema";
import { and, eq, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { dropItemFiles, fileOf } from "./file-names";
import { stampEntryThreads } from "./library-change-sets";
import { noteBlocksOf } from "./library-codec";
import { askAutoFile } from "./auto-file-job";
import { askFills } from "./library-fills";
import { compareText } from "@repo/contract/library/order-key";

import { mintLibraryId } from "./library-ids";
import { containersUnder, parentOfTarget } from "./library-parents";
import { landNewItems } from "./library-landing";
import type { LiveItemRow, NewItem } from "./library-landing";
import { refuse, RefusedWriteError } from "./library-refusal";
import { readItem, STORED_ITEM_COLUMNS, tagsOf } from "./library-rows";
import type { StoredItem } from "./library-rows";
import type { WriteScope } from "./library-store";
import { landFields } from "./library-writes";
import { askFileTextAgain, readsText } from "./file-text-job";
import { anyOf } from "./set-sql";

export const landNew = async (scope: WriteScope, made: NewItem) => {
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
  readonly parentId: string | null;
  readonly savedAt: number;
}

export const createFile = async (scope: WriteScope, input: CreateFileInput) => {
  const held = await fileOf(scope.tx, scope.accountId, input.sha);

  if (held === null) {
    return refuse({ kind: "blob-missing", shas: [input.sha] });
  }

  const made = await landNew(scope, {
    blocks: [],
    fields: fileFields({ ...input, mime: held.mime }),
    id: input.id,
  });

  await askAutoFile(scope, made.id);

  return made;
};

export interface CreateNoteInput {
  readonly markdown: string;
  readonly parent?: ParentTarget | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly title?: string | undefined;
}

export const createNote = async (scope: WriteScope, input: CreateNoteInput) => {
  const id = mintLibraryId(scope.now);
  const parentId = await parentOfTarget(scope, input.parent, [{ id, kind: "note" }]);

  return await landNew(scope, {
    blocks: await noteBlocksOf(scope, input.markdown),
    fields: noteFields({
      parentId: parentId ?? null,
      savedAt: scope.now,
      tags: input.tags ?? [],
      title: input.title ?? "",
    }),
    id,
  });
};

export const organizeItems = async (scope: WriteScope, input: OrganizeInput) => {
  const read: StoredItem[] = [];

  for (const itemId of new Set(input.ids)) {
    const held = await readItem(scope.tx, scope.accountId, itemId);

    if (held === null) {
      return refuse({ kind: "not-found" });
    }

    read.push(held);
  }

  const parentId = await parentOfTarget(
    scope,
    input.parent,
    read.map(({ fields, id }) => ({ id, kind: fields.kind })),
  );

  const landed: LiveItemRow[] = [];

  for (const held of read) {
    landed.push(await landFields(scope, held, organized(held.fields, input, parentId, scope.now)));
  }

  return landed;
};

export interface CreateItemInput {
  readonly id: string;
  readonly kind: "note" | "folder" | "list";
  readonly blocks: NewItem["blocks"];
  readonly parentId: string | null;
  readonly savedAt: number;
  readonly tags: readonly string[];
  readonly title: string;
}

export const createItem = async (scope: WriteScope, input: CreateItemInput) => {
  await parentOfTarget(scope, input.parentId === null ? null : { id: input.parentId }, [
    { id: input.id, kind: input.kind },
  ]);

  return await landNew(scope, {
    blocks: input.blocks,
    fields: {
      ...noteFields(input),
      kind: input.kind,
      list: input.kind === "list" ? NEW_LIST : null,
    },
    id: input.id,
  });
};

export interface SetListInput {
  readonly id: string;
  readonly list: ListSettings;
  readonly renames: readonly PropertyRename[];
}

export const setList = async (scope: WriteScope, input: SetListInput) => {
  const held = await readItem(scope.tx, scope.accountId, input.id);

  if (held === null) {
    return refuse({ kind: "not-found" });
  }

  if (held.fields.kind !== "list" || held.fields.deletedAt !== null) {
    return refuse({ kind: "conflict" });
  }

  if (input.renames.length > 0) {
    const children = await scope.tx
      .select(STORED_ITEM_COLUMNS)
      .from(item)
      .where(and(eq(item.accountId, scope.accountId), eq(item.parentId, input.id)));

    for (const child of children) {
      const properties = renamedProperties(child.fields.properties, input.renames);

      if (!sameJson(properties, child.fields.properties)) {
        await landFields(scope, child, { ...child.fields, properties });
      }
    }
  }

  return await landFields(scope, held, { ...held.fields, list: input.list });
};

export const landedSummaries = async (scope: WriteScope, rows: readonly LiveItemRow[]) => {
  const tags = await tagsOf(
    scope.tx,
    scope.accountId,
    rows.map(({ id }) => id),
  );

  return rows.map((row) => itemSummary(itemListing(row, tags.get(row.id) ?? [])));
};

interface BulkAnswer {
  readonly changed: string[];
  readonly missing: string[];
  readonly addressHeld: string[];
}

const deletedLastFirst = (a: StoredItem, b: StoredItem) =>
  (b.fields.deletedAt ?? 0) - (a.fields.deletedAt ?? 0) || compareText(a.id, b.id);

export const setDeleted = async (
  scope: WriteScope,
  input: { readonly ids: readonly string[]; readonly deleted: boolean },
) => {
  const changed: string[] = [];
  const missing: string[] = [];
  const addressHeld: string[] = [];
  const read: StoredItem[] = [];

  const asked = input.deleted ? await containersUnder(scope, input.ids) : input.ids;

  for (const itemId of new Set(asked)) {
    const held = await readItem(scope.tx, scope.accountId, itemId);

    if (held === null) {
      missing.push(itemId);
    } else {
      read.push(held);
    }
  }

  const ordered = input.deleted ? read : read.toSorted(deletedLastFirst);

  for (const held of ordered) {
    const itemId = held.id;

    if ((held.fields.deletedAt !== null) === input.deleted) {
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
        if (!(error instanceof RefusedWriteError) || error.refusal.kind !== "url-held") {
          throw error;
        }

        addressHeld.push(itemId);
      }
    }
  }

  return { addressHeld, changed, missing } satisfies BulkAnswer;
};

export const refreshItem = async (scope: WriteScope, itemId: string) => {
  const held = await readItem(scope.tx, scope.accountId, itemId);
  const fileSha = held !== null && readsText(held.fields) ? shownFileSha(held.fields) : null;

  if (held !== null && held.fields.url === null && fileSha !== null) {
    await askFileTextAgain(scope, itemId, fileSha);

    return await landFields(scope, held, held.fields);
  }

  if (held === null || held.fields.url === null) {
    return refuse({ kind: "not-found" });
  }

  const landed = await landFields(scope, held, withReading(held.fields, { kind: "asked" }));
  await askFills(scope, [landed]);

  return landed;
};

export const saveEditedFile = async (
  scope: WriteScope,
  input: { readonly id: string; readonly sha: string | null },
) => {
  const held = await readItem(scope.tx, scope.accountId, input.id);

  if (held === null || held.fields.kind !== "pdf" || held.fields.originalSha === null) {
    return refuse({ kind: "not-found" });
  }

  const landed = await landFields(scope, held, { ...held.fields, editedSha: input.sha });
  const shown = shownFileSha(landed.fields);

  if (shown !== null && shown !== shownFileSha(held.fields)) {
    await askFileTextAgain(scope, input.id, shown);
  }

  return landed;
};

export const restoreDeleted = async (scope: WriteScope, ids: readonly string[]) => {
  if (ids.length === 0) {
    return new Set() satisfies Set<string>;
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
