// The replica's own SQL over the shared schema (`@repo/notes/library/library-schema`): where its
// pull stands, a pulled change laid only over an older row, the bodies it wants, the reset that
// starts it over, and the reads its screens list from. Each is a plan, run inside the replica's
// transaction.

import type {
  annotationOpSchema,
  folderOpSchema,
  libraryChangeSchema,
  liveItemRowSchema,
  threadEventRowSchema,
  threadRowSchema,
} from "@repo/contract/cloud/library/library-wire";
import { THREAD_STATUSES } from "@repo/contract/cloud/library/library-wire";
import { urlKey } from "@repo/notes/items/item-url";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import { deriveItem } from "@repo/notes/library/derive-item";
import type { ListingFolder } from "@repo/notes/library/library-index";
import {
  blockWritesOf,
  dropBlocks,
  readItem,
  readItemState,
  readMeta,
  storeBlocks,
  storeDerived,
  storeItemRow,
  storeSearchRow,
  storeTombstone,
  writeMeta,
} from "@repo/notes/library/library-queries";
import { all, chunkStatement, LibraryRowError, run } from "@repo/notes/library/library-sql";
import type { SqlPlan, SqlRow, SqlStatement } from "@repo/notes/library/library-sql";
import { z } from "zod";

type LibraryChange = z.infer<typeof libraryChangeSchema>;
type LiveItemRow = z.infer<typeof liveItemRowSchema>;
type ThreadRow = z.infer<typeof threadRowSchema>;
type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

const runEach = function* runEach(statements: readonly SqlStatement[]): SqlPlan<void> {
  for (const statement of statements) {
    yield run(statement.sql, statement.params);
  }
};

// ---- where the pull stands ----

// the library the rows came from, the cursor the last page ended at, and the newest head heard,
// from a pull or the socket
export interface SyncState {
  readonly epoch: string | null;
  readonly cursor: number;
  readonly head: number;
}

const counterSchema = z.number().int().nonnegative();
const epochSchema = z.string().min(1);

const counterOf = (value: string | number | null): number =>
  value === null ? 0 : counterSchema.parse(value);

export const readSyncState = function* readSyncState(): SqlPlan<SyncState> {
  const epoch = yield* readMeta("epoch");
  return {
    cursor: counterOf(yield* readMeta("cursor")),
    epoch: epoch === null ? null : epochSchema.parse(epoch),
    head: counterOf(yield* readMeta("head")),
  };
};

export const writeSyncState = function* writeSyncState(state: SyncState): SqlPlan<void> {
  if (state.epoch !== null) {
    yield* writeMeta("epoch", state.epoch);
  }
  yield* writeMeta("cursor", state.cursor);
  yield* writeMeta("head", state.head);
};

// ---- what a page touched ----

// the kinds of row a page or a landing moved, and the ids it moved: an item's (for its row, its
// body or its highlights), a folder's, a thread's (for it or its events) or a file's sha
export interface Touched {
  readonly kinds: Set<LibraryChange["kind"]>;
  readonly ids: Set<string>;
}

export const touchedNothing = (): Touched => ({ ids: new Set(), kinds: new Set() });

const touch = (touched: Touched, kind: LibraryChange["kind"], id: string): void => {
  touched.kinds.add(kind);
  touched.ids.add(id);
};

// ---- an item ----

const ITEM_TABLES = [
  "DELETE FROM blocks WHERE item_id = ?",
  "DELETE FROM links WHERE source_id = ?",
  "DELETE FROM item_tags WHERE item_id = ?",
  "DELETE FROM annotations WHERE item_id = ?",
  "DELETE FROM item_blobs WHERE item_id = ?",
  "DELETE FROM body_wants WHERE item_id = ?",
] as const;

const wantBody = function* wantBody(itemId: string, seq: number): SqlPlan<void> {
  yield run(
    `INSERT INTO body_wants (item_id, seq) VALUES (?, ?)
     ON CONFLICT (item_id) DO UPDATE SET seq = excluded.seq`,
    [itemId, seq],
  );
};

// its links, tags and index row again from the fields that landed and the body held, which the
// body's own landing derives again once it arrives
const deriveHeld = function* deriveHeld(itemId: string): SqlPlan<void> {
  const state = yield* readItemState(itemId);
  if (state === null) {
    return;
  }
  const derived = deriveItem(state.fields, state.blocks);
  yield* storeDerived(itemId, derived);
  yield* storeSearchRow(itemId, derived.search);
};

// a live row over an older one, its body wanted at the row's sequence. The cell holds one live
// item per address at every sequence, so of two items this replica holds at one address the one
// at the lower sequence is a row the cell has moved on from, whose newer change is still to come:
// it gives up the address meanwhile, whichever of the two landed first
const layLiveRow = function* layLiveRow(row: LiveItemRow): SqlPlan<boolean> {
  let key = row.fields.url === null ? null : urlKey(row.fields.url);
  if (key !== null && row.fields.deletedAt === null) {
    const newer = yield all(
      `SELECT id FROM items WHERE url_key = ? AND id <> ? AND deleted_at IS NULL AND seq > ?
       LIMIT 1`,
      [key, row.id, row.seq],
    );
    if (newer.length > 0) {
      key = null;
    } else {
      yield run(
        `UPDATE items SET url_key = NULL
         WHERE url_key = ? AND id <> ? AND deleted_at IS NULL AND seq < ?`,
        [key, row.id, row.seq],
      );
    }
  }
  const landed = yield* storeItemRow({
    card: row.card,
    fields: row.fields,
    id: row.id,
    seq: row.seq,
    updatedAt: row.updatedAt,
    urlKey: key,
  });
  if (landed) {
    yield* deriveHeld(row.id);
    yield* wantBody(row.id, row.seq);
  }
  return landed;
};

const forgetItem = function* forgetItem(itemId: string): SqlPlan<void> {
  yield run("DELETE FROM search_fts WHERE rowid = (SELECT rid FROM items WHERE id = ?)", [itemId]);
  for (const sql of ITEM_TABLES) {
    yield run(sql, [itemId]);
  }
  yield run("DELETE FROM items WHERE id = ?", [itemId]);
};

const applyItem = function* applyItem(
  change: Extract<LibraryChange, { kind: "item" }>,
  touched: Touched,
): SqlPlan<void> {
  const held = yield* readItem(change.id);
  if (held !== null && held.seq >= change.seq) {
    return;
  }
  const { row } = change;
  if (row === null) {
    yield* forgetItem(change.id);
  } else if (row.kind === "purged") {
    yield* storeTombstone({
      deletedAt: row.deletedAt ?? row.updatedAt,
      id: row.id,
      seq: row.seq,
      updatedAt: row.updatedAt,
    });
    yield run("DELETE FROM body_wants WHERE item_id = ?", [row.id]);
  } else {
    yield* layLiveRow(row);
  }
  touch(touched, "item", change.id);
};

// ---- the other rows ----

const applyFolder = function* applyFolder(
  change: Extract<LibraryChange, { kind: "folder" }>,
  touched: Touched,
): SqlPlan<void> {
  const { row } = change;
  yield row === null
    ? run("DELETE FROM folders WHERE id = ? AND seq < ?", [change.id, change.seq])
    : run(
        `INSERT INTO folders (id, parent_id, name, sort, deleted_at, seq) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name,
         sort = excluded.sort, deleted_at = excluded.deleted_at, seq = excluded.seq
       WHERE excluded.seq > folders.seq`,
        [row.id, row.parentId, row.name, row.sort, row.deletedAt, row.seq],
      );
  touch(touched, "folder", change.id);
};

const heldItemOfSchema = z.object({ item_id: z.string() });

const applyAnnotation = function* applyAnnotation(
  change: Extract<LibraryChange, { kind: "annotation" }>,
  touched: Touched,
): SqlPlan<void> {
  const { row } = change;
  if (row === null) {
    const [held] = yield all("SELECT item_id FROM annotations WHERE id = ?", [change.id]);
    yield run("DELETE FROM annotations WHERE id = ? AND seq < ?", [change.id, change.seq]);
    if (held !== undefined) {
      touch(touched, "annotation", heldItemOfSchema.parse(held).item_id);
    }
    return;
  }
  yield run(
    `INSERT INTO annotations (id, item_id, parent_id, text, quote, occurrence, source, created_at,
       updated_at, deleted_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET item_id = excluded.item_id, parent_id = excluded.parent_id,
       text = excluded.text, quote = excluded.quote, occurrence = excluded.occurrence,
       source = excluded.source, created_at = excluded.created_at,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, seq = excluded.seq
     WHERE excluded.seq > annotations.seq`,
    [
      row.id,
      row.itemId,
      row.parentId,
      row.text,
      row.quote,
      row.occurrence,
      row.source,
      row.createdAt,
      row.updatedAt,
      row.deletedAt,
      row.seq,
    ],
  );
  touch(touched, "annotation", row.itemId);
};

const applyBlob = function* applyBlob(
  change: Extract<LibraryChange, { kind: "blob" }>,
  touched: Touched,
): SqlPlan<void> {
  const { row } = change;
  // a file never changes under its sha; which items hold it is the cell's to count
  yield row === null
    ? run("DELETE FROM blobs WHERE sha256 = ?", [change.id])
    : run(
        `INSERT INTO blobs (sha256, bytes, mime, w, h, refs) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT (sha256) DO UPDATE SET bytes = excluded.bytes, mime = excluded.mime,
         w = excluded.w, h = excluded.h`,
        [row.sha, row.bytes, row.mime, row.w, row.h],
      );
  touch(touched, "blob", change.id);
};

const applyThread = function* applyThread(
  change: Extract<LibraryChange, { kind: "thread" }>,
  touched: Touched,
): SqlPlan<void> {
  const { row } = change;
  yield row === null
    ? run("DELETE FROM threads WHERE id = ? AND seq < ?", [change.id, change.seq])
    : run(
        `INSERT INTO threads (id, session_id, title, status, created_at, updated_at, seq)
       VALUES (?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, status = excluded.status,
         created_at = excluded.created_at, updated_at = excluded.updated_at, seq = excluded.seq
       WHERE excluded.seq > threads.seq`,
        [row.id, row.title, row.status, row.createdAt, row.updatedAt, row.seq],
      );
  touch(touched, "thread", change.id);
};

const heldThreadOfSchema = z.object({ thread_id: z.string() });

const applyThreadEvent = function* applyThreadEvent(
  change: Extract<LibraryChange, { kind: "thread_event" }>,
  touched: Touched,
): SqlPlan<void> {
  const { row } = change;
  if (row === null) {
    const [held] = yield all("SELECT thread_id FROM thread_events WHERE event_id = ?", [change.id]);
    yield run("DELETE FROM thread_events WHERE event_id = ? AND seq < ?", [change.id, change.seq]);
    if (held !== undefined) {
      touch(touched, "thread_event", heldThreadOfSchema.parse(held).thread_id);
    }
    return;
  }
  yield run(
    `INSERT INTO thread_events (event_id, thread_id, idx, type, json, at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_id) DO UPDATE SET thread_id = excluded.thread_id, idx = excluded.idx,
       type = excluded.type, json = excluded.json, at = excluded.at, seq = excluded.seq
     WHERE excluded.seq > thread_events.seq`,
    [row.eventId, row.threadId, row.idx, row.type, JSON.stringify(row.event), row.at, row.seq],
  );
  touch(touched, "thread_event", row.threadId);
};

// one entry of the change log, laid only over an older row
export const applyChange = function* applyChange(
  change: LibraryChange,
  touched: Touched,
): SqlPlan<void> {
  switch (change.kind) {
    case "item": {
      yield* applyItem(change, touched);
      return;
    }
    case "folder": {
      yield* applyFolder(change, touched);
      return;
    }
    case "annotation": {
      yield* applyAnnotation(change, touched);
      return;
    }
    case "blob": {
      yield* applyBlob(change, touched);
      return;
    }
    case "thread": {
      yield* applyThread(change, touched);
      return;
    }
    case "thread_event": {
      yield* applyThreadEvent(change, touched);
    }
    // no default
  }
};

// ---- a reset ----

// every table the cell's log fills, and the bodies wanted of them; the outbox stays, since what
// the person wrote is still to land in whichever library this one is now
const SYNCED_TABLES = [
  "items",
  "blocks",
  "folders",
  "item_tags",
  "links",
  "annotations",
  "blobs",
  "item_blobs",
  "search_fts",
  "threads",
  "thread_events",
  "changes",
  "body_wants",
] as const;

export const wipeSynced = function* wipeSynced(epoch: string | null): SqlPlan<void> {
  for (const table of SYNCED_TABLES) {
    yield run(`DELETE FROM ${table}`);
  }
  yield run("DELETE FROM meta WHERE k IN ('epoch', 'cursor', 'head')");
  yield* writeSyncState({ cursor: 0, epoch, head: 0 });
};

// ---- this device's own landings ----

// a write's answer: the item's row as it landed, and the blocks this device wrote, which are the
// cell's at that sequence; the rest of the body is wanted again, since another device may have
// changed it on the way
export const landOwnRow = function* landOwnRow(
  row: LiveItemRow,
  blocks: { readonly written: readonly StoredBlock[]; readonly dropped: readonly string[] },
): SqlPlan<boolean> {
  const landed = yield* layLiveRow(row);
  if (!landed || (blocks.written.length === 0 && blocks.dropped.length === 0)) {
    return landed;
  }
  yield* dropBlocks(row.id, blocks.dropped);
  const state = yield* readItemState(row.id);
  if (state === null) {
    throw new LibraryRowError(`the item ${row.id} did not read back from its own landing`);
  }
  const after = new Map(state.blocks);
  for (const stored of blocks.written) {
    after.set(stored.block.id, stored);
  }
  const derived = deriveItem(state.fields, after);
  yield* storeBlocks(row.id, blockWritesOf(blocks.written, derived), row.seq);
  yield* storeDerived(row.id, derived);
  yield* storeSearchRow(row.id, derived.search);
  return landed;
};

// items a delete landed for, until the pull brings their rows as the cell holds them
export const markDeleted = function* markDeleted(
  ids: readonly string[],
  deletedAt: number,
): SqlPlan<void> {
  yield* runEach(
    chunkStatement({
      each: "?",
      head: "UPDATE items SET deleted_at = ? WHERE purged = 0 AND id IN (",
      headParams: [deletedAt],
      rows: ids.map((id) => [id]),
      separator: ", ",
      tail: ")",
    }),
  );
};

// items a restore landed for, until the pull brings their rows. The cell restores an item only
// while no other live item holds its address, so one this replica still lists live there is a row
// whose newer change is still to come: it gives up the address, as a pulled row's older holder does
export const markRestored = function* markRestored(ids: readonly string[]): SqlPlan<void> {
  for (const id of ids) {
    yield run(
      `UPDATE items SET url_key = NULL
       WHERE id <> ? AND deleted_at IS NULL
         AND url_key = (SELECT url_key FROM items WHERE id = ? AND deleted_at IS NOT NULL)`,
      [id, id],
    );
    yield run("UPDATE items SET deleted_at = NULL WHERE id = ? AND purged = 0", [id]);
  }
};

type FolderOp = z.infer<typeof folderOpSchema>;
type AnnotationOp = z.infer<typeof annotationOpSchema>;

// A landing this device made shows at once in rows the cell's own change then replaces: a folder
// or a highlight it made stands at sequence 0, below every row the cell stamps, and one it changed
// keeps the sequence it held, so the pull lays the cell's row over each whatever it holds

// a folder write's ops as the cell landed them, until the pull brings their rows
export const landOwnFolders = function* landOwnFolders(
  ops: readonly FolderOp[],
  at: number,
): SqlPlan<void> {
  for (const op of ops) {
    switch (op.op) {
      case "create": {
        yield run(
          `INSERT INTO folders (id, parent_id, name, sort, deleted_at, seq)
           VALUES (?, ?, ?, ?, NULL, 0) ON CONFLICT (id) DO NOTHING`,
          [op.id, op.parentId, op.name, op.sort],
        );
        break;
      }
      case "rename": {
        yield run("UPDATE folders SET name = ? WHERE id = ?", [op.name, op.id]);
        break;
      }
      case "move": {
        yield run("UPDATE folders SET parent_id = ?, sort = ? WHERE id = ?", [
          op.parentId,
          op.sort,
          op.id,
        ]);
        break;
      }
      case "delete": {
        yield run("UPDATE folders SET deleted_at = ? WHERE id = ?", [at, op.id]);
        break;
      }
      // no default
    }
  }
};

// a write's highlight ops as the cell landed them, signed as the person's, until the pull brings
// their rows; times are unix seconds, as a highlight's are
export const landOwnAnnotations = function* landOwnAnnotations(
  itemId: string,
  ops: readonly AnnotationOp[],
  atSeconds: number,
): SqlPlan<void> {
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        yield run(
          `INSERT INTO annotations (id, item_id, parent_id, text, quote, occurrence, source,
             created_at, updated_at, deleted_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?, NULL, 0) ON CONFLICT (id) DO NOTHING`,
          [op.id, itemId, op.parentId, op.text, op.quote, op.occurrence, op.createdAt, atSeconds],
        );
        break;
      }
      case "note": {
        yield run("UPDATE annotations SET text = ?, updated_at = ? WHERE id = ?", [
          op.text,
          atSeconds,
          op.id,
        ]);
        break;
      }
      case "remove": {
        yield run(
          `UPDATE annotations SET deleted_at = ?, updated_at = ?
           WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`,
          [atSeconds, atSeconds, op.id, op.id],
        );
        break;
      }
      // no default
    }
  }
};

// ---- what the screens read ----

const folderRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable(),
  sort: z.string(),
});

export const readFolders = function* readFolders(): SqlPlan<ListingFolder[]> {
  const rows = yield all(
    "SELECT id, parent_id, name, sort FROM folders WHERE deleted_at IS NULL ORDER BY id",
  );
  return rows.map((raw) => {
    const row = folderRowSchema.parse(raw);
    return { id: row.id, name: row.name, parentId: row.parent_id, sort: row.sort };
  });
};

const tagRowSchema = z.object({ item_id: z.string(), tag: z.string() });

const tagRowsOf = function* tagRowsOf(itemIds: readonly string[]): SqlPlan<SqlRow[]> {
  const rows: SqlRow[] = [];
  for (const statement of chunkStatement({
    each: "?",
    head: "SELECT item_id, tag FROM item_tags WHERE item_id IN (",
    rows: itemIds.map((id) => [id]),
    separator: ", ",
    tail: ") ORDER BY item_id, tag",
  })) {
    rows.push(...(yield all(statement.sql, statement.params)));
  }
  return rows;
};

// every tag each item carries, its field's and its body's
export const readTagsByItem = function* readTagsByItem(
  itemIds: readonly string[] | null,
): SqlPlan<Map<string, string[]>> {
  const rows =
    itemIds === null
      ? yield all("SELECT item_id, tag FROM item_tags ORDER BY item_id, tag")
      : yield* tagRowsOf(itemIds);
  const tags = new Map<string, string[]>();
  for (const raw of rows) {
    const row = tagRowSchema.parse(raw);
    const held = tags.get(row.item_id) ?? [];
    if (!held.includes(row.tag)) {
      held.push(row.tag);
    }
    tags.set(row.item_id, held);
  }
  return tags;
};

const wantRowSchema = z.object({ item_id: z.string(), seq: z.number() });

export interface BodyWant {
  readonly itemId: string;
  readonly seq: number;
}

export const readWants = function* readWants(): SqlPlan<BodyWant[]> {
  const rows = yield all("SELECT item_id, seq FROM body_wants");
  return rows.map((raw) => {
    const row = wantRowSchema.parse(raw);
    return { itemId: row.item_id, seq: row.seq };
  });
};

export const dropWants = function* dropWants(itemIds: readonly string[]): SqlPlan<void> {
  yield* runEach(
    chunkStatement({
      each: "?",
      head: "DELETE FROM body_wants WHERE item_id IN (",
      rows: itemIds.map((id) => [id]),
      separator: ", ",
      tail: ")",
    }),
  );
};

const threadSqlSchema = z.object({
  created_at: z.number(),
  id: z.string(),
  seq: z.number(),
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
  updated_at: z.number(),
});

// the account's threads, the newest first
export const readThreads = function* readThreads(): SqlPlan<ThreadRow[]> {
  const rows = yield all(
    "SELECT id, title, status, created_at, updated_at, seq FROM threads ORDER BY updated_at DESC, id",
  );
  return rows.map((raw) => {
    const row = threadSqlSchema.parse(raw);
    return {
      createdAt: row.created_at,
      id: row.id,
      seq: row.seq,
      status: row.status,
      title: row.title,
      updatedAt: row.updated_at,
    };
  });
};

const eventJsonSchema = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});

const threadEventSqlSchema = z.object({
  at: z.number(),
  event_id: z.string(),
  idx: z.number(),
  json: eventJsonSchema,
  seq: z.number(),
  thread_id: z.string(),
  type: z.string(),
});

// a thread's events in the order the cell stored them
export const readThreadEvents = function* readThreadEvents(
  threadId: string,
): SqlPlan<ThreadEventRow[]> {
  const rows = yield all(
    `SELECT event_id, thread_id, idx, type, json, at, seq FROM thread_events
     WHERE thread_id = ? ORDER BY idx`,
    [threadId],
  );
  return rows.map((raw) => {
    const row = threadEventSqlSchema.parse(raw);
    return {
      at: row.at,
      event: row.json,
      eventId: row.event_id,
      idx: row.idx,
      seq: row.seq,
      threadId: row.thread_id,
      type: row.type,
    };
  });
};
