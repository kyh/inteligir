// What a replica pulls: the change log after its cursor, each entry with its row as it is now (null
// once it is gone), never ending a page inside one write; and the bodies it wants, in the order it
// asks, about 4 MB an answer. A replica whose epoch is not the library's starts over from nothing.

import type {
  libraryChangeSchema,
  storedBlockSchema,
  threadEventRowSchema,
  threadRowSchema,
} from "@repo/contract/cloud/library/library-wire";
import { THREAD_STATUSES } from "@repo/contract/cloud/library/library-wire";
import { canonicalJson, utf8ByteLength } from "@repo/notes/library/canonical-json";
import { readBlocks, readChanges, readItem, readMeta } from "@repo/notes/library/library-queries";
import type { ChangeEntry } from "@repo/notes/library/library-queries";
import { LibraryRowError, runPlan } from "@repo/notes/library/library-sql";
import type { SqlRow, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { annotationWireRow, readAnnotationRow } from "./cell-annotations";
import { readBlobRow } from "./cell-blobs";

type LibraryChange = z.infer<typeof libraryChangeSchema>;
type StoredBlockRow = z.infer<typeof storedBlockSchema>;

// what one pull carries, give or take the rest of the write it ends inside
const PULL_PAGE_CHANGES = 1000;
// what one bodies answer carries, the first body whatever its size
const BODIES_ANSWER_BYTES = 4 * 1024 * 1024;

const epochSchema = z.string().min(1);
const headSchema = z.number().int().nonnegative();

const libraryEpoch = (sql: SqlStatements): string => {
  const epoch = epochSchema.safeParse(runPlan(sql, readMeta("epoch")));
  if (!epoch.success) {
    throw new LibraryRowError("the library has no epoch", { cause: epoch.error });
  }
  return epoch.data;
};

export const libraryHead = (sql: SqlStatements): number => {
  const head = runPlan(sql, readMeta("head"));
  return head === null ? 0 : headSchema.parse(head);
};

export type PullAnswer =
  | {
      readonly kind: "changes";
      readonly changes: LibraryChange[];
      readonly epoch: string;
      readonly head: number;
      readonly more: boolean;
      readonly upto: number;
    }
  | { readonly kind: "reset"; readonly epoch: string };

const folderRowSchema = z.object({
  deleted_at: z.number().nullable(),
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable(),
  seq: z.number(),
  sort: z.string(),
});

const threadSqlSchema = z.object({
  created_at: z.number(),
  id: z.string(),
  seq: z.number(),
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
  updated_at: z.number(),
});

const threadEventSqlSchema = z.object({
  at: z.number(),
  event_id: z.string(),
  idx: z.number(),
  json: z.string(),
  seq: z.number(),
  thread_id: z.string(),
  type: z.string(),
});

type ThreadRow = z.infer<typeof threadRowSchema>;
type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

const itemRowOf = (
  sql: SqlStatements,
  id: string,
): Extract<LibraryChange, { kind: "item" }>["row"] => {
  const item = runPlan(sql, readItem(id));
  if (item === null) {
    return null;
  }
  return item.kind === "purged"
    ? { deletedAt: item.deletedAt, id, kind: "purged", seq: item.seq, updatedAt: item.updatedAt }
    : {
        card: { ...item.card, outline: [...item.card.outline] },
        fields: item.fields,
        id,
        kind: "live",
        seq: item.seq,
        updatedAt: item.updatedAt,
      };
};

const folderRowOf = (sql: SqlStatements, id: string) => {
  const [raw] = sql.all(
    "SELECT id, parent_id, name, sort, deleted_at, seq FROM folders WHERE id = ?",
    [id],
  );
  if (raw === undefined) {
    return null;
  }
  const row = folderRowSchema.parse(raw);
  return {
    deletedAt: row.deleted_at,
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    seq: row.seq,
    sort: row.sort,
  };
};

export const THREAD_COLUMNS = "id, title, status, created_at, updated_at, seq";

export const threadRowFrom = (raw: SqlRow): ThreadRow => {
  const row = threadSqlSchema.parse(raw);
  return {
    createdAt: row.created_at,
    id: row.id,
    seq: row.seq,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
};

const threadRowOf = (sql: SqlStatements, id: string): ThreadRow | null => {
  const [raw] = sql.all(`SELECT ${THREAD_COLUMNS} FROM threads WHERE id = ?`, [id]);
  return raw === undefined ? null : threadRowFrom(raw);
};

const eventJsonSchema = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});

export const THREAD_EVENT_COLUMNS = "event_id, thread_id, idx, type, json, at, seq";

export const threadEventRowFrom = (raw: SqlRow): ThreadEventRow => {
  const row = threadEventSqlSchema.parse(raw);
  return {
    at: row.at,
    event: eventJsonSchema.parse(row.json),
    eventId: row.event_id,
    idx: row.idx,
    seq: row.seq,
    threadId: row.thread_id,
    type: row.type,
  };
};

const threadEventRowOf = (sql: SqlStatements, id: string): ThreadEventRow | null => {
  const [raw] = sql.all(`SELECT ${THREAD_EVENT_COLUMNS} FROM thread_events WHERE event_id = ?`, [
    id,
  ]);
  return raw === undefined ? null : threadEventRowFrom(raw);
};

const changeOf = (sql: SqlStatements, entry: ChangeEntry): LibraryChange => {
  const { id, seq } = entry;
  switch (entry.kind) {
    case "item": {
      return { id, kind: "item", row: entry.gone ? null : itemRowOf(sql, id), seq };
    }
    case "folder": {
      return { id, kind: "folder", row: entry.gone ? null : folderRowOf(sql, id), seq };
    }
    case "annotation": {
      const row = entry.gone ? null : readAnnotationRow(sql, id);
      return { id, kind: "annotation", row: row === null ? null : annotationWireRow(row), seq };
    }
    case "blob": {
      return { id, kind: "blob", row: entry.gone ? null : readBlobRow(sql, id), seq };
    }
    case "thread": {
      return { id, kind: "thread", row: entry.gone ? null : threadRowOf(sql, id), seq };
    }
    case "thread_event": {
      return { id, kind: "thread_event", row: entry.gone ? null : threadEventRowOf(sql, id), seq };
    }
    // no default
  }
};

// a fresh replica (no epoch, cursor 0) pulls from the start; one that names another library, or a
// cursor with no library behind it, starts over
export const pullChanges = (
  sql: SqlStatements,
  request: { readonly cursor: number; readonly epoch: string | null },
): PullAnswer => {
  const epoch = libraryEpoch(sql);
  const stale = request.epoch === null ? request.cursor > 0 : request.epoch !== epoch;
  if (stale) {
    return { epoch, kind: "reset" };
  }
  const page = runPlan(sql, readChanges(request.cursor, PULL_PAGE_CHANGES));
  return {
    changes: page.changes.map((entry) => changeOf(sql, entry)),
    epoch,
    head: libraryHead(sql),
    kind: "changes",
    more: page.more,
    upto: page.upto,
  };
};

export interface BodiesAnswer {
  readonly bodies: {
    readonly blocks: StoredBlockRow[];
    readonly id: string;
    readonly seq: number;
  }[];
  readonly deferred: string[];
  readonly gone: string[];
}

export const readBodies = (sql: SqlStatements, ids: readonly string[]): BodiesAnswer => {
  const bodies: { blocks: StoredBlockRow[]; id: string; seq: number }[] = [];
  const deferred: string[] = [];
  const gone: string[] = [];
  let bytes = 0;
  for (const id of ids) {
    if (bytes >= BODIES_ANSWER_BYTES) {
      deferred.push(id);
      continue;
    }
    const item = runPlan(sql, readItem(id));
    if (item?.kind !== "live") {
      gone.push(id);
      continue;
    }
    const blocks = runPlan(sql, readBlocks(id));
    bytes += blocks.reduce((sum, stored) => sum + utf8ByteLength(canonicalJson(stored.block)), 0);
    bodies.push({ blocks, id, seq: item.seq });
  }
  return { bodies, deferred, gone };
};
