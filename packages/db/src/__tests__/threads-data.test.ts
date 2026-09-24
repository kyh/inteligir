import { createConnection, writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import { describe, expect, it, vi } from "vitest";
import { noopNotifier } from "@repo/domain/notifier";
import type { DbNotifier } from "@repo/domain/notifier";
import { openTempDb } from "./open-temp-db";
import {
  applyThreadLifecycleEventInTransaction,
  archiveThread,
  createThread,
  getThread,
  listRunningThreads,
  listThreads,
  rebindThreadOrigins,
} from "../threads";
import type {
  ApplyThreadLifecycleEventArgs,
  ApplyThreadLifecycleEventOutcome,
  ThreadListQuery,
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
  originDocPath: null,
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

  it("stores the doc attachment", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {
      originDocPath: "notes/today.md",
    });
    expect(thread.originDocPath).toBe("notes/today.md");
  });

  it("lists live threads before archived ones", () => {
    const db = openTempDb();
    const first = createThread(db, noopNotifier, { title: "a" });
    const second = createThread(db, noopNotifier, { title: "b" });
    archiveThread(db, noopNotifier, first.id);
    const { rows } = listThreads(db, { ...EVERY_LIVE_THREAD, includeArchived: true });
    expect(rows.map((thread) => thread.id)).toEqual([second.id, first.id]);
  });

  it("archives once, idempotently, and fires archived-changed", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const thread = createThread(db, noopNotifier, {});
    const archived = archiveThread(db, notifier, thread.id);
    expect(archived?.archivedAt).not.toBeNull();
    const again = archiveThread(db, notifier, thread.id);
    expect(again?.archivedAt).toBe(archived?.archivedAt);
    expect(threadChanges).toEqual([{ changes: ["archived-changed"], threadId: thread.id }]);
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

    archiveThread(db, noopNotifier, thread.id);
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
    const onNote = createThread(db, noopNotifier, { originDocPath: "notes/a.md" });
    createThread(db, noopNotifier, { originDocPath: "notes/b.md" });
    const running = createThread(db, noopNotifier, {});
    applyLifecycle(db, { event: { type: "run.preparing" }, threadId: running.id });
    const archivedRunning = createThread(db, noopNotifier, {});
    applyLifecycle(db, { event: { type: "run.preparing" }, threadId: archivedRunning.id });
    archiveThread(db, noopNotifier, archivedRunning.id);

    const ids = (query: Partial<ThreadListQuery>): string[] =>
      listThreads(db, { ...EVERY_LIVE_THREAD, ...query }).rows.map((row) => row.id);
    expect(ids({ originDocPath: "notes/a.md" })).toEqual([onNote.id]);
    expect(ids({ running: true })).toEqual([running.id]);
    expect(ids({ includeArchived: true, running: true })).toEqual([running.id, archivedRunning.id]);
    expect(
      listRunningThreads(db)
        .map((row) => row.id)
        .toSorted(),
    ).toEqual([running.id, archivedRunning.id].toSorted());
  });
});

describe("doc-attached threads", () => {
  it("rebinds a moved doc's threads from the origin index, not a table scan", () => {
    const db = openTempDb();
    // rebindThreadOrigins' file-move UPDATE, spelled out because EXPLAIN needs raw sql.
    const plan = db.$client
      .prepare(
        "EXPLAIN QUERY PLAN UPDATE threads SET origin_doc_path = 'b.md' WHERE origin_doc_path = 'a.md'",
      )
      .all()
      .map((step) => JSON.stringify(step))
      .join("\n");
    expect(plan).toContain("threads_origin_doc_idx");
  });
});

describe("rebindThreadOrigins", () => {
  it("follows a renamed file and announces each moved thread", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const first = createThread(db, notifier, { originDocPath: "Plans.md" });
    const second = createThread(db, notifier, { originDocPath: "Plans.md" });
    const elsewhere = createThread(db, notifier, { originDocPath: "Other.md" });
    threadChanges.length = 0;

    expect(rebindThreadOrigins(db, notifier, { from: "Plans.md", to: "Archive/Moved.md" })).toBe(2);
    expect(getThread(db, first.id)?.originDocPath).toBe("Archive/Moved.md");
    expect(getThread(db, second.id)?.originDocPath).toBe("Archive/Moved.md");
    expect(getThread(db, elsewhere.id)?.originDocPath).toBe("Other.md");
    expect(threadChanges.map((change) => change.changes[0])).toEqual([
      "origin-changed",
      "origin-changed",
    ]);
  });

  it("follows a renamed DIRECTORY for every doc under it", () => {
    const db = openTempDb();
    const nested = createThread(db, noopNotifier, { originDocPath: "Notes/deep/a.md" });
    const sibling = createThread(db, noopNotifier, { originDocPath: "Notes2/b.md" });

    expect(rebindThreadOrigins(db, noopNotifier, { from: "Notes", to: "Archive" })).toBe(1);
    expect(getThread(db, nested.id)?.originDocPath).toBe("Archive/deep/a.md");
    expect(getThread(db, sibling.id)?.originDocPath).toBe("Notes2/b.md");
  });

  it("follows a directory whose name carries a LIKE wildcard", () => {
    const db = openTempDb();
    const nested = createThread(db, noopNotifier, { originDocPath: "50%/a.md" });
    const sibling = createThread(db, noopNotifier, { originDocPath: "50x/b.md" });

    expect(rebindThreadOrigins(db, noopNotifier, { from: "50%", to: "Archive" })).toBe(1);
    expect(getThread(db, nested.id)?.originDocPath).toBe("Archive/a.md");
    expect(getThread(db, sibling.id)?.originDocPath).toBe("50x/b.md");
  });

  it("is a no-op when nothing is bound to the moved path", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    createThread(db, notifier, {});
    threadChanges.length = 0;
    expect(rebindThreadOrigins(db, notifier, { from: "Nothing.md", to: "Else.md" })).toBe(0);
    expect(threadChanges).toEqual([]);
  });

  it("moves nothing and announces nothing when a write fails partway through a folder", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const exact = createThread(db, notifier, { originDocPath: "Notes" });
    const nested = createThread(db, notifier, { originDocPath: "Notes/a.md" });
    threadChanges.length = 0;
    // the exact-path UPDATE runs first and succeeds; the descendant's is the one refused.
    db.$client.exec(`
      CREATE TRIGGER refuse_rebind BEFORE UPDATE OF origin_doc_path ON threads
      WHEN NEW.origin_doc_path = 'Archive/a.md'
      BEGIN SELECT RAISE(ABORT, 'refused mid-rebind'); END;
    `);

    expect(() => rebindThreadOrigins(db, notifier, { from: "Notes", to: "Archive" })).toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({ message: "refused mid-rebind" }),
      }),
    );
    expect(getThread(db, exact.id)?.originDocPath).toBe("Notes");
    expect(getThread(db, nested.id)?.originDocPath).toBe("Notes/a.md");
    expect(threadChanges).toEqual([]);
  });
});
