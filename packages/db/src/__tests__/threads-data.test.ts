import { createConnection, writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import { describe, expect, it, vi } from "vitest";
import { noopNotifier } from "@repo/domain/notifier";
import type { DbNotifier } from "@repo/domain/notifier";
import { openTempDb } from "./open-temp-db";
import {
  applyThreadLifecycleEventInTransaction,
  applyThreadMetaInTransaction,
  archiveThreadInTransaction,
  createThread,
  ensureThreadInTransaction,
  getThread,
  listRunningThreads,
  listThreads,
} from "../threads";
import type {
  ApplyThreadLifecycleEventArgs,
  ApplyThreadLifecycleEventOutcome,
  ThreadListQuery,
  ThreadMetaChange,
  ThreadMetaFacts,
  ThreadRow,
} from "../threads";
import { threads } from "../schema";

interface RecordedThreadChange {
  threadId: string;
  changes: ThreadChangeKind[];
}

interface RecordingNotifier {
  notifier: DbNotifier;
  threadChanges: RecordedThreadChange[];
}

const recordingNotifier = (): RecordingNotifier => {
  const threadChanges: RecordedThreadChange[] = [];
  return {
    notifier: {
      ...noopNotifier,
      notifyThread(threadId, changes) {
        threadChanges.push({ changes, threadId });
      },
    },
    threadChanges,
  };
};

const EVERY_LIVE_THREAD = {
  after: null,
  includeArchived: false,
  limit: 50,
  origin: null,
  running: false,
} satisfies ThreadListQuery;

// three threads to a millisecond, so every page boundary can fall inside a tie.
const seedThreads = (
  db: DbConnection,
  count: number,
  { archivedEvery }: { archivedEvery: number },
): ThreadRow[] =>
  writeTransaction(db, (tx) =>
    Array.from({ length: count }, (_, index) => {
      const updatedAt = 1_700_000_000_000 + Math.floor(index / 3);
      return tx
        .insert(threads)
        .values({
          archivedAt: archivedEvery > 0 && index % archivedEvery === 0 ? updatedAt : null,
          createdAt: updatedAt,
          id: `thr_${String(index).padStart(4, "0")}`,
          status: "idle",
          updatedAt,
        })
        .returning()
        .get();
    }),
  );

const listingOrder = (rows: readonly ThreadRow[]): ThreadRow[] =>
  rows.toSorted((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1));

const walkPages = (db: DbConnection, query: ThreadListQuery): string[] => {
  const ids: string[] = [];
  let { after } = query;
  for (;;) {
    const page = listThreads(db, { ...query, after });
    ids.push(...page.rows.map((row) => row.id));
    if (page.next === null) {
      return ids;
    }
    after = page.next;
  }
};

// the transaction the server composes every lifecycle projection in.
const applyLifecycle = (
  db: DbConnection,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome =>
  writeTransaction(db, (tx) => applyThreadLifecycleEventInTransaction(tx, args));

const archive = (db: DbConnection, threadId: string): boolean =>
  writeTransaction(db, (tx) => archiveThreadInTransaction(tx, threadId));

const applyMeta = (db: DbConnection, threadId: string, facts: ThreadMetaFacts): ThreadMetaChange =>
  writeTransaction(db, (tx) => applyThreadMetaInTransaction(tx, { facts, threadId }));

describe("thread CRUD", () => {
  it("creates idle threads and fires thread-created", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const thread = createThread(db, notifier, { title: "Research" });
    expect(thread.status).toBe("idle");
    expect(thread.title).toBe("Research");
    expect(thread.originDocPath).toBeNull();
    expect(getThread(db, thread.id)).toEqual(thread);
    expect(threadChanges).toEqual([{ changes: ["thread-created"], threadId: thread.id }]);
  });

  it("stores the doc attachment, with the note's id when it has one", () => {
    const db = openTempDb();
    const identified = createThread(db, noopNotifier, {
      origin: { noteId: "note-today", path: "notes/today.md" },
    });
    expect(identified).toMatchObject({
      originDocPath: "notes/today.md",
      originNoteId: "note-today",
    });
    const pathOnly = createThread(db, noopNotifier, {
      origin: { noteId: null, path: "notes/draft.md" },
    });
    expect(pathOnly).toMatchObject({ originDocPath: "notes/draft.md", originNoteId: null });
  });

  it("lists live threads before archived ones", () => {
    const db = openTempDb();
    const first = createThread(db, noopNotifier, { title: "a" });
    const second = createThread(db, noopNotifier, { title: "b" });
    archive(db, first.id);
    const { rows } = listThreads(db, { ...EVERY_LIVE_THREAD, includeArchived: true });
    expect(rows.map((thread) => thread.id)).toEqual([second.id, first.id]);
  });

  it("archives once, keeping the time it was first archived at", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    expect(archive(db, thread.id)).toBe(true);
    const archivedAt = getThread(db, thread.id)?.archivedAt;
    expect(archivedAt).not.toBeNull();
    expect(archive(db, thread.id)).toBe(false);
    expect(getThread(db, thread.id)?.archivedAt).toBe(archivedAt);
    expect(archive(db, "thr_missing")).toBe(false);
  });
});

describe("applyThreadMetaInTransaction", () => {
  it("gives a thread the log created bare its title, origin and harness", () => {
    const db = openTempDb();
    writeTransaction(db, (tx) => ensureThreadInTransaction(tx, "thr_synced"));

    expect(
      applyMeta(db, "thr_synced", {
        originDocPath: "Plans.md",
        originNoteId: "note-plans",
        providerId: "codex",
        title: "Plan the week",
      }),
    ).toEqual({ origin: true, title: true });
    expect(getThread(db, "thr_synced")).toMatchObject({
      originDocPath: "Plans.md",
      originNoteId: "note-plans",
      providerId: "codex",
      title: "Plan the week",
    });
  });

  it("takes an origin's path and note id as one statement", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {
      origin: { noteId: "note-plans", path: "Plans.md" },
    });

    expect(applyMeta(db, thread.id, { originNoteId: "note-other" })).toEqual({
      origin: false,
      title: false,
    });
    expect(applyMeta(db, thread.id, { originDocPath: "Plans.md" })).toEqual({
      origin: true,
      title: false,
    });
    expect(getThread(db, thread.id)).toMatchObject({
      originDocPath: "Plans.md",
      originNoteId: null,
    });
  });

  it("changes nothing when a replay states what the thread already holds", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {
      origin: { noteId: null, path: "Plans.md" },
      title: "Plan",
    });
    const before = getThread(db, thread.id);

    expect(applyMeta(db, thread.id, { originDocPath: "Plans.md", title: "Plan" })).toEqual({
      origin: false,
      title: false,
    });
    expect(getThread(db, thread.id)).toEqual(before);
  });

  it("moves the title and the origin to the latest statement, and keeps a bound harness", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {
      origin: { noteId: null, path: "Plans.md" },
    });
    applyMeta(db, thread.id, { providerId: "claude", title: "Named from the first line" });

    expect(
      applyMeta(db, thread.id, {
        originDocPath: "Archive/Plans.md",
        providerId: "codex",
        title: "Explicit",
      }),
    ).toEqual({ origin: true, title: true });
    expect(getThread(db, thread.id)).toMatchObject({
      originDocPath: "Archive/Plans.md",
      providerId: "claude",
      title: "Explicit",
    });
  });

  it("leaves absent facts as they are, and a missing thread alone", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {
      origin: { noteId: null, path: "Plans.md" },
      title: "Plan",
    });

    expect(applyMeta(db, thread.id, { providerId: "codex" })).toEqual({
      origin: false,
      title: false,
    });
    expect(getThread(db, thread.id)).toMatchObject({
      originDocPath: "Plans.md",
      providerId: "codex",
      title: "Plan",
    });
    expect(applyMeta(db, "thr_missing", { title: "Nobody" })).toEqual({
      origin: false,
      title: false,
    });
  });
});

describe("applyThreadLifecycleEventInTransaction", () => {
  it("walks the happy path, binding and unbinding the turn", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});

    for (const [event, expectedStatus, expectedTurn] of [
      [{ type: "run.preparing" }, "starting", null],
      [{ turnId: "turn_1", type: "run.started" }, "active", "turn_1"],
      [{ turnId: "turn_1", type: "run.succeeded" }, "idle", null],
    ] as const) {
      const outcome = applyLifecycle(db, { event, threadId: thread.id });
      expect(outcome.applied).toBe(true);
      if (outcome.applied) {
        expect(outcome.thread.status).toBe(expectedStatus);
        expect(outcome.thread.activeTurnId).toBe(expectedTurn);
      }
    }
  });

  it("makes a settle for a turn that is no longer active a typed no-op", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    applyLifecycle(db, {
      event: { turnId: "turn_a", type: "run.started" },
      threadId: thread.id,
    });
    applyLifecycle(db, {
      event: { turnId: "turn_a", type: "run.succeeded" },
      threadId: thread.id,
    });
    applyLifecycle(db, {
      event: { turnId: "turn_b", type: "run.started" },
      threadId: thread.id,
    });

    const stale = applyLifecycle(db, {
      event: { turnId: "turn_a", type: "run.succeeded" },
      threadId: thread.id,
    });
    expect(stale).toMatchObject({ applied: false, reason: "stale-turn" });
    const row = getThread(db, thread.id);
    expect(row?.status).toBe("active");
    expect(row?.activeTurnId).toBe("turn_b");
  });

  it("returns typed no-ops instead of throwing", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});

    const illegal = applyLifecycle(db, {
      event: { turnId: null, type: "stop.settled" },
      threadId: thread.id,
    });
    expect(illegal).toMatchObject({ applied: false, reason: "illegal-transition" });

    const missing = applyLifecycle(db, {
      event: { type: "run.preparing" },
      threadId: "thr_missing",
    });
    expect(missing).toMatchObject({ applied: false, reason: "not-found" });

    archive(db, thread.id);
    const superseded = applyLifecycle(db, {
      event: { type: "run.preparing" },
      threadId: thread.id,
    });
    expect(superseded).toMatchObject({ applied: false, reason: "superseded" });
  });

  it("stays consistent when two connections alternate lifecycle writes", () => {
    const db = openTempDb();
    const rival = createConnection(db.$client.name);
    const thread = createThread(db, noopNotifier, {});

    const first = applyLifecycle(db, {
      event: { turnId: "turn_1", type: "run.started" },
      threadId: thread.id,
    });
    expect(first.applied).toBe(true);
    const rivalStart = applyLifecycle(rival, {
      event: { turnId: "turn_2", type: "run.started" },
      threadId: thread.id,
    });
    expect(rivalStart).toMatchObject({ applied: false, reason: "illegal-transition" });

    const rivalSettle = applyLifecycle(rival, {
      event: { turnId: "turn_1", type: "run.succeeded" },
      threadId: thread.id,
    });
    expect(rivalSettle.applied).toBe(true);
    const staleSettle = applyLifecycle(db, {
      event: { turnId: "turn_1", type: "run.succeeded" },
      threadId: thread.id,
    });
    expect(staleSettle).toMatchObject({ applied: false, reason: "stale-turn" });
    expect(getThread(db, thread.id)?.status).toBe("idle");
  });
});

describe("listThreads query plan", () => {
  it("answers a cursor's page in both segments from their partial indexes, with no temp b-tree", () => {
    const db = openTempDb();
    seedThreads(db, 4, { archivedEvery: 2 });
    const [cursorRow] = listThreads(db, { ...EVERY_LIVE_THREAD, limit: 1 }).rows;
    if (cursorRow === undefined) {
      throw new Error("expected a live thread to page from");
    }
    const prepared: string[] = [];
    const client = db.$client;
    const original = client.prepare.bind(client);
    const spy = vi.spyOn(client, "prepare").mockImplementation((source: string) => {
      prepared.push(source);
      return original(source);
    });
    listThreads(db, {
      ...EVERY_LIVE_THREAD,
      after: { archived: false, id: cursorRow.id, updatedAt: cursorRow.updatedAt },
      includeArchived: true,
    });
    spy.mockRestore();

    // the plan does not depend on the values, only on how many placeholders there are.
    const plans = prepared.map((source) =>
      db.$client
        .prepare(`EXPLAIN QUERY PLAN ${source}`)
        .all(...Array.from(source.matchAll(/\?/gu), () => 0))
        .map((step) => JSON.stringify(step))
        .join("\n"),
    );
    expect(plans).toHaveLength(2);
    expect(plans[0]).toContain("threads_live_updated_id_idx");
    expect(plans[1]).toContain("threads_archived_updated_id_idx");
    for (const plan of plans) {
      expect(plan).not.toContain("TEMP B-TREE");
    }
  });
});

describe("listThreads paging", () => {
  it("answers one page of a thousand threads, and its cursor walks the rest once each", () => {
    const db = openTempDb();
    const seeded = seedThreads(db, 1000, { archivedEvery: 0 });

    const first = listThreads(db, EVERY_LIVE_THREAD);
    expect(first.rows).toHaveLength(EVERY_LIVE_THREAD.limit);
    expect(first.next).not.toBeNull();

    expect(walkPages(db, EVERY_LIVE_THREAD)).toEqual(listingOrder(seeded).map((row) => row.id));
  });

  it("leaves archived threads out unless asked, then pages across into them", () => {
    const db = openTempDb();
    const seeded = seedThreads(db, 120, { archivedEvery: 3 });
    const live = seeded.filter((row) => row.archivedAt === null);
    const archived = seeded.filter((row) => row.archivedAt !== null);

    expect(walkPages(db, EVERY_LIVE_THREAD)).toEqual(listingOrder(live).map((row) => row.id));
    expect(walkPages(db, { ...EVERY_LIVE_THREAD, includeArchived: true, limit: 7 })).toEqual(
      [...listingOrder(live), ...listingOrder(archived)].map((row) => row.id),
    );
  });

  it("ends a listing without archived threads at a cursor from the archived segment", () => {
    const db = openTempDb();
    seedThreads(db, 4, { archivedEvery: 2 });
    const page = listThreads(db, {
      ...EVERY_LIVE_THREAD,
      after: { archived: true, id: "thr_zzzzzzzzzz", updatedAt: Number.MAX_SAFE_INTEGER },
    });
    expect(page).toEqual({ next: null, rows: [] });
  });

  it("answers the full last page with no cursor, so a caller never asks for an empty one", () => {
    const db = openTempDb();
    seedThreads(db, 4, { archivedEvery: 0 });
    const page = listThreads(db, { ...EVERY_LIVE_THREAD, limit: 4 });
    expect(page.rows).toHaveLength(4);
    expect(page.next).toBeNull();
  });

  it("filters by the note a thread is attached to and by a running turn", () => {
    const db = openTempDb();
    const onNote = createThread(db, noopNotifier, {
      origin: { noteId: null, path: "notes/a.md" },
    });
    createThread(db, noopNotifier, { origin: { noteId: null, path: "notes/b.md" } });
    const byId = createThread(db, noopNotifier, {
      origin: { noteId: "note-a", path: "old/a.md" },
    });
    const running = createThread(db, noopNotifier, {});
    applyLifecycle(db, { event: { type: "run.preparing" }, threadId: running.id });
    const archivedRunning = createThread(db, noopNotifier, {});
    applyLifecycle(db, { event: { type: "run.preparing" }, threadId: archivedRunning.id });
    archive(db, archivedRunning.id);

    const ids = (query: Partial<ThreadListQuery>): string[] =>
      listThreads(db, { ...EVERY_LIVE_THREAD, ...query }).rows.map((row) => row.id);
    expect(ids({ origin: { noteId: null, path: "notes/a.md" } })).toEqual([onNote.id]);
    expect(ids({ origin: { noteId: "note-a", path: "notes/a.md" } }).toSorted()).toEqual(
      [byId.id, onNote.id].toSorted(),
    );
    expect(ids({ running: true })).toEqual([running.id]);
    expect(ids({ includeArchived: true, running: true })).toEqual([running.id, archivedRunning.id]);
    expect(
      listRunningThreads(db)
        .map((row) => row.id)
        .toSorted(),
    ).toEqual([running.id, archivedRunning.id].toSorted());
  });
});
