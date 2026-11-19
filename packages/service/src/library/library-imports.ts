import { urlKey } from "@repo/contract/items/item-url";
import type { IMPORT_STANDINGS } from "@repo/contract/library/library-wire";
import type { importedItemSchema } from "@repo/contract/rpc/library-contract";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { item, itemFile, purgedItem } from "@repo/db/library-schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { askFills } from "./library-fills";
import { folderOfTarget } from "./library-folders";
import { mintLibraryId } from "./library-ids";
import { restoreDeleted } from "./library-items";
import { landNewItems } from "./library-landing";
import type { NewItem } from "./library-landing";
import type { WriteScope } from "./library-store";
import { anyOf } from "./set-sql";

type ImportedItem = z.infer<typeof importedItemSchema>;

type NewImported = Extract<ImportedItem, { kind: "new" }>;

export const IMPORT_ACTOR = { kind: "import" } as const;

export const importLandedSchema = z.object({
  added: z.number(),
  alreadySaved: z.number(),
  unreadable: z.number(),
});

interface NoteStanding {
  readonly id: string;
  readonly standing: (typeof IMPORT_STANDINGS)[number];
}

const keyOf = (url: string | null) => (url === null ? null : urlKey(url));

export const settleNotes = async (
  db: DbExecutor,
  accountId: string,
  notes: readonly { readonly id: string; readonly url: string | null }[],
) => {
  const ids = notes.map(({ id }) => id);
  const keys = notes.flatMap(({ url }) => keyOf(url) ?? []);

  const [items, purged, holders] = await Promise.all([
    db
      .select({ deletedAt: item.deletedAt, id: item.id })
      .from(item)
      .where(and(eq(item.accountId, accountId), anyOf(item.id, ids))),
    db
      .select({ id: purgedItem.id })
      .from(purgedItem)
      .where(and(eq(purgedItem.accountId, accountId), anyOf(purgedItem.id, ids))),
    keys.length === 0
      ? []
      : db
          .select({ id: item.id, urlKey: item.urlKey })
          .from(item)
          .where(
            and(eq(item.accountId, accountId), isNull(item.deletedAt), anyOf(item.urlKey, keys)),
          ),
  ]);

  const deletedAt = new Map(items.map((row) => [row.id, row.deletedAt]));
  const gone = new Set(purged.map((row) => row.id));
  const holderAt = new Map(holders.map((row) => [row.urlKey, row.id]));
  const now = Date.now();

  return notes.map((note) => {
    const held = deletedAt.get(note.id);

    if (held === null) {
      return { id: note.id, standing: "held" } satisfies NoteStanding;
    }

    const key = keyOf(note.url);
    const holder = key === null ? undefined : holderAt.get(key);

    if (holder !== undefined) {
      return { id: holder, standing: "held" } satisfies NoteStanding;
    }

    if (held !== undefined) {
      return { id: note.id, standing: "deleted" } satisfies NoteStanding;
    }

    return {
      id: gone.has(note.id) ? mintLibraryId(now) : note.id,
      standing: "new",
    } satisfies NoteStanding;
  });
};

export const namedFiles = async (db: DbExecutor, accountId: string, shas: readonly string[]) => {
  const rows = await db
    .selectDistinct({ originalSha: item.originalSha, sha256: itemFile.sha256 })
    .from(itemFile)
    .innerJoin(item, and(eq(item.accountId, itemFile.accountId), eq(item.id, itemFile.itemId)))
    .where(
      and(eq(itemFile.accountId, accountId), isNull(item.deletedAt), anyOf(itemFile.sha256, shas)),
    );

  return {
    named: [...new Set(rows.map((row) => row.sha256))],
    originals: [
      ...new Set(rows.flatMap((row) => (row.originalSha === row.sha256 ? [row.sha256] : []))),
    ],
  };
};

const foldersOf = async (scope: WriteScope, made: readonly NewImported[]) => {
  const folders = new Map<string, string | null>();

  for (const path of new Set(made.flatMap(({ folder }) => folder ?? []))) {
    folders.set(path, (await folderOfTarget(scope, { path })) ?? null);
  }

  return folders;
};

const heldIds = async (scope: WriteScope, made: readonly NewImported[]) => {
  const rows = await scope.tx
    .select({ id: item.id })
    .from(item)
    .where(
      and(
        eq(item.accountId, scope.accountId),
        anyOf(
          item.id,
          made.map(({ id }) => id),
        ),
      ),
    );

  return new Set(rows.map((row) => row.id)) satisfies Set<string>;
};

const landNew = async (scope: WriteScope, made: readonly NewImported[]) => {
  const held = await heldIds(scope, made);
  const seen = new Set<string>();

  const fresh = made.filter(({ id }) => {
    const first = !held.has(id) && !seen.has(id);
    seen.add(id);

    return first;
  });

  const folders = await foldersOf(scope, fresh);

  const outcomes = await landNewItems(
    scope,
    fresh.map(
      (each) =>
        ({
          blocks: each.blocks,
          fields: {
            ...each.fields,
            deletedAt: null,
            folderId: each.folder === null ? null : (folders.get(each.folder) ?? null),
          },
          id: each.id,
        }) satisfies NewItem,
    ),
  );

  const landed = outcomes.flatMap((outcome, at) =>
    outcome.ok ? [{ ...outcome.value, cover: fresh[at]?.cover ?? null }] : [],
  );

  await askFills(scope, landed);
  const refusals = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.refusal]));
  const urlHeld = refusals.filter((refusal) => refusal.kind === "url-held").length;

  return {
    added: landed.length,
    alreadySaved: made.length - fresh.length + urlHeld,
    unreadable: refusals.length - urlHeld,
  };
};

export const landImported = async (scope: WriteScope, batch: readonly ImportedItem[]) => {
  const made = batch.filter((each): each is NewImported => each.kind === "new");
  const back = batch.flatMap((each) => (each.kind === "restore" ? [each.id] : []));
  const added = made.length === 0 ? null : await landNew(scope, made);
  const restored = await restoreDeleted(scope, back);

  return {
    added: (added?.added ?? 0) + restored.size,
    alreadySaved: (added?.alreadySaved ?? 0) + back.length - restored.size,
    unreadable: added?.unreadable ?? 0,
  } satisfies z.input<typeof importLandedSchema>;
};
