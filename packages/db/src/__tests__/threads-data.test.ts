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
  it("walks the happy path and fires status-changed per applied event", () => {
    const db = openTempDb();
    const { notifier, threadChanges } = recordingNotifier();
    const thread = createThread(db, noopNotifier, {});

    for (const [type, expected] of [
      ["run.preparing", "starting"],
      ["run.started", "active"],
      ["run.succeeded", "idle"],
    ] as const) {
      const outcome = applyThreadLifecycleEvent(db, notifier, {
        threadId: thread.id,
        event: { type },
      });
      expect(outcome.applied).toBe(true);
      if (outcome.applied) {
        expect(outcome.thread.status).toBe(expected);
      }
    }
    expect(threadChanges.map((change) => change.changes)).toEqual([
      ["status-changed"],
      ["status-changed"],
      ["status-changed"],
    ]);
  });

  it("returns typed no-ops instead of throwing", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});

    const illegal = applyThreadLifecycleEvent(db, noopNotifier, {
      threadId: thread.id,
      event: { type: "stop.settled" },
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
});
