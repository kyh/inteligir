import type { DbConnection } from "@repo/db/connection";
import {
  listAllOpenPendingInteractions,
  listOpenPendingInteractions,
} from "@repo/db/pending-interactions";
import type { PendingInteractionRow } from "@repo/db/pending-interactions";
import { listQueuedThreadMessages } from "@repo/db/queued-messages";
import { getThread, listThreads } from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type {
  GetThreadResponse,
  ListThreadsResponse,
  ParsedListThreadsQuery,
  PendingInteraction,
  Thread,
  TimelineQuery,
  TimelineResponse,
} from "@repo/contract/local/threads/threads-schema";
import {
  encodeThreadListCursor,
  THREADS_LIST_DEFAULT_LIMIT,
} from "@repo/contract/local/threads/threads-schema";
import { computeTimelineDelta } from "@repo/contract/local/thread-timeline";
import type { ThreadOrigins } from "./thread-origins";
import type { ThreadTimelineProjector } from "./timeline-projection";

const toWireThread = (row: ThreadRow, originDocPath: string | null): Thread => ({
  activeTurnId: row.activeTurnId,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  id: row.id,
  originDocPath,
  providerId: row.providerId,
  status: row.status,
  title: row.title,
  updatedAt: row.updatedAt,
});

export const toWirePendingInteraction = (row: PendingInteractionRow): PendingInteraction => ({
  createdAt: row.createdAt,
  decision: row.decision,
  id: row.id,
  payload: row.payload,
  requestKey: row.requestKey,
  resolvedAt: row.resolvedAt,
  status: row.status,
  threadId: row.threadId,
  turnId: row.turnId,
});

// the stored path answers for a note with no id, or one no indexed doc carries any more.
export const wireThread = async (
  db: DbConnection,
  origins: ThreadOrigins,
  row: ThreadRow,
): Promise<Thread> => {
  const { originDocPath, originNoteId } = row;
  if (originDocPath === null || originNoteId === null) {
    return toWireThread(row, originDocPath);
  }
  const resolved = await origins.pathForNoteId(originNoteId, originDocPath);
  return toWireThread(row, resolved ?? originDocPath);
};

export const listThreadPage = async (
  db: DbConnection,
  origins: ThreadOrigins,
  query: ParsedListThreadsQuery,
): Promise<ListThreadsResponse> => {
  const path = query.originDocPath ?? null;
  const page = listThreads(db, {
    after: query.cursor ?? null,
    contains: query.query ?? null,
    includeArchived: query.includeArchived ?? false,
    limit: query.limit ?? THREADS_LIST_DEFAULT_LIMIT,
    origin: path === null ? null : { noteId: await origins.noteIdOf(path), path },
    running: query.running ?? false,
  });
  const threads = await Promise.all(
    page.rows.map(async (row) => await wireThread(db, origins, row)),
  );
  return {
    nextCursor: page.next === null ? null : encodeThreadListCursor(page.next),
    // the page is narrowed by the stored path or the note's id; the answer is where each row
    // resolves now, so a row whose note moved away leaves the page short, never wrong.
    threads: path === null ? threads : threads.filter((thread) => thread.originDocPath === path),
  };
};

export const threadDetail = async (
  db: DbConnection,
  origins: ThreadOrigins,
  threadId: string,
): Promise<GetThreadResponse | null> => {
  const thread = getThread(db, threadId);
  if (thread === null) {
    return null;
  }
  return {
    pendingInteractions: listOpenPendingInteractions(db, threadId).map(toWirePendingInteraction),
    queuedMessages: listQueuedThreadMessages(db, threadId).map((row) => ({
      createdAt: row.createdAt,
      id: row.id,
      text: row.text,
    })),
    thread: await wireThread(db, origins, thread),
  };
};

export const openInteractions = (
  db: DbConnection,
  threadId: string | undefined,
): PendingInteraction[] => {
  const rows =
    threadId === undefined
      ? listAllOpenPendingInteractions(db)
      : listOpenPendingInteractions(db, threadId);
  return rows.map(toWirePendingInteraction);
};

export const threadTimeline = (
  db: DbConnection,
  timelines: ThreadTimelineProjector,
  query: TimelineQuery,
): TimelineResponse | null => {
  if (getThread(db, query.threadId) === null) {
    return null;
  }
  const full = timelines.full(query.threadId);
  // a client ahead of the log (a rebuilt db) gets the full timeline.
  if (query.afterSequence === undefined || query.afterSequence > full.maxSequence) {
    return { kind: "full", timeline: full };
  }
  const base = timelines.prefix(query.threadId, query.afterSequence);
  return { delta: computeTimelineDelta(base, full), kind: "delta" };
};
