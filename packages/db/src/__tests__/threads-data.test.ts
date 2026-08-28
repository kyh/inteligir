import { createConnection } from "../connection";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import { describe, expect, it } from "vitest";
import { noopNotifier, type DbNotifier } from "@repo/domain/notifier";
import { openTempDb } from "./open-temp-db";
import {
  applyThreadLifecycleEvent,
  archiveThread,
  createThread,
  getThread,
  listThreads,
  rebindThreadOrigins,
} from "../threads";

interface RecordedThreadChange {
  threadId: string;
  changes: ThreadChangeKind[];
}

/** A notifier plus the list it appends every thread change to. */
interface RecordingNotifier {
  notifier: DbNotifier;
  threadChanges: RecordedThreadChange[];
}

function recordingNotifier(): RecordingNotifier {
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
});

describe("doc-attached threads", () => {
  it("rebinds a moved doc's threads from the origin index, not a table scan", () => {
    const db = openTempDb();
    // The statement is rebindThreadOrigins' file-move UPDATE, spelled out
    // because EXPLAIN needs raw SQL; the pin is the planner of the BUNDLED
    // sqlite choosing threads_origin_doc_idx, same style as the listThreads
    // plan suite above.
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
    // A sibling whose path merely shares the prefix must NOT move.
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
});
