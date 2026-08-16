import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadChangeKind } from "@repo/server-contract/notifications";
import { afterEach, describe, expect, it } from "vitest";
import { createConnection, type DbConnection } from "../connection";
import { runMigrations } from "../migrate";
import { noopNotifier, type DbNotifier } from "../notifier";
import {
  applyThreadLifecycleEvent,
  archiveThread,
  createThread,
  getThread,
  listThreads,
} from "../threads";

const tempDirs: string[] = [];

function openTempDb(): DbConnection {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-db-test-"));
  tempDirs.push(dir);
  const db = createConnection(join(dir, "test.db"));
  runMigrations(db);
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface RecordedThreadChange {
  threadId: string;
  changes: ThreadChangeKind[];
}

function recordingNotifier(): { notifier: DbNotifier; threadChanges: RecordedThreadChange[] } {
  const threadChanges: RecordedThreadChange[] = [];
  return {
    threadChanges,
    notifier: {
      ...noopNotifier,
      notifyThread(threadId, changes) {
        threadChanges.push({ threadId, changes });
      },
    },
  };
}

describe("thread CRUD", () => {
  it("creates idle threads and fires thread-created", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const thread = createThread(db, notifier, { title: "Research" });
    expect(thread.status).toBe("idle");
    expect(thread.title).toBe("Research");
    expect(thread.originDocPath).toBeNull();
    expect(getThread(db, thread.id)).toEqual(thread);
    expect(threadChanges).toEqual([{ threadId: thread.id, changes: ["thread-created"] }]);
  });

  it("stores the doc-bound origin pair", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {
      originDocPath: "notes/today.md",
      originAnchor: "task-3",
    });
    expect(thread.originDocPath).toBe("notes/today.md");
    expect(thread.originAnchor).toBe("task-3");
  });

  it("lists live threads before archived ones", () => {
    const db = openTempDb();
    const first = createThread(db, noopNotifier, { title: "a" });
    const second = createThread(db, noopNotifier, { title: "b" });
    archiveThread(db, noopNotifier, first.id);
    expect(listThreads(db).map((thread) => thread.id)).toEqual([second.id, first.id]);
  });

  it("archives once, idempotently, and fires archived-changed", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const thread = createThread(db, noopNotifier, {});
    const archived = archiveThread(db, notifier, thread.id);
    expect(archived?.archivedAt).not.toBeNull();
    const again = archiveThread(db, notifier, thread.id);
    expect(again?.archivedAt).toBe(archived?.archivedAt);
    expect(threadChanges).toEqual([{ threadId: thread.id, changes: ["archived-changed"] }]);
  });
});

describe("applyThreadLifecycleEvent", () => {
  it("walks the happy path, binding and unbinding the turn, firing status-changed per applied event", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const thread = createThread(db, noopNotifier, {});

    for (const [event, expectedStatus, expectedTurn] of [
      [{ type: "run.preparing" }, "starting", null],
      [{ type: "run.started", turnId: "turn_1" }, "active", "turn_1"],
      [{ type: "run.succeeded", turnId: "turn_1" }, "idle", null],
    ] as const) {
      const outcome = applyThreadLifecycleEvent(db, notifier, {
        threadId: thread.id,
        event,
      });
      expect(outcome.applied).toBe(true);
      if (outcome.applied) {
        expect(outcome.thread.status).toBe(expectedStatus);
        expect(outcome.thread.activeTurnId).toBe(expectedTurn);
      }
    }
    expect(threadChanges.map((change) => change.changes)).toEqual([
      ["status-changed"],
      ["status-changed"],
      ["status-changed"],
    ]);
  });

  it("makes a settle for a turn that is no longer active a typed no-op", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.started", turnId: "turn_a" },
    });
    applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.succeeded", turnId: "turn_a" },
    });
    applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.started", turnId: "turn_b" },
    });

    // The late (duplicate) completion for turn_a must not settle turn_b.
    const stale = applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.succeeded", turnId: "turn_a" },
    });
    expect(stale).toMatchObject({ applied: false, reason: "stale-turn" });
    const row = getThread(db, thread.id);
    expect(row?.status).toBe("active");
    expect(row?.activeTurnId).toBe("turn_b");
  });

  it("returns typed no-ops instead of throwing", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});

    const illegal = applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "stop.settled", turnId: null },
    });
    expect(illegal).toMatchObject({ applied: false, reason: "illegal-transition" });

    const missing = applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: "thr_missing",
      event: { type: "run.preparing" },
    });
    expect(missing).toMatchObject({ applied: false, reason: "not-found" });

    archiveThread(db, noopNotifier, thread.id);
    const superseded = applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.preparing" },
    });
    expect(superseded).toMatchObject({ applied: false, reason: "superseded" });
  });

  it("stays consistent when two connections alternate lifecycle writes", () => {
    const db = openTempDb();
    const rival = createConnection(db.$client.name);
    const thread = createThread(db, noopNotifier, {});

    // Each step is a full immediate transaction on its own connection; the
    // (status, activeTurnId) CAS turns every lost race into a typed no-op.
    const first = applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.started", turnId: "turn_1" },
    });
    expect(first.applied).toBe(true);
    const rivalStart = applyThreadLifecycleEvent(rival, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.started", turnId: "turn_2" },
    });
    expect(rivalStart).toMatchObject({ applied: false, reason: "illegal-transition" });

    const rivalSettle = applyThreadLifecycleEvent(rival, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.succeeded", turnId: "turn_1" },
    });
    expect(rivalSettle.applied).toBe(true);
    const staleSettle = applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "run.succeeded", turnId: "turn_1" },
    });
    expect(staleSettle).toMatchObject({ applied: false, reason: "stale-turn" });
    expect(getThread(db, thread.id)?.status).toBe("idle");
  });
});

describe("listThreads query plan", () => {
  it("answers both halves from their partial indexes, with no temp b-tree sort", () => {
    const db = openTempDb();
    const plans = [
      "SELECT * FROM threads WHERE archived_at IS NULL ORDER BY updated_at DESC",
      "SELECT * FROM threads WHERE archived_at IS NOT NULL ORDER BY updated_at DESC",
    ].map((query) =>
      db.$client
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .all()
        .map((step) => JSON.stringify(step))
        .join("\n"),
    );
    expect(plans[0]).toContain("threads_live_updated_idx");
    expect(plans[1]).toContain("threads_archived_updated_idx");
    for (const plan of plans) {
      expect(plan).not.toContain("TEMP B-TREE");
    }
  });

  it("refuses a half-bound origin pair at the database", () => {
    const db = openTempDb();
    expect(() =>
      db.$client
        .prepare(
          `INSERT INTO threads (id, title, status, active_turn_id, origin_doc_path, origin_anchor, archived_at, created_at, updated_at)
           VALUES ('thr_bad', NULL, 'idle', NULL, 'notes/a.md', NULL, NULL, 0, 0)`,
        )
        .run(),
    ).toThrow(/CHECK/u);
  });
});
