import { createConnection, writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import { describe, expect, it } from "vitest";
import { noopNotifier } from "@repo/domain/notifier";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import {
  createPendingInteraction,
  getPendingInteraction,
  listOpenPendingInteractions,
  resolvePendingInteraction,
} from "../pending-interactions";
import {
  claimNextQueuedThreadMessageInTransaction,
  createQueuedThreadMessageInTransaction,
  deleteClaimedQueuedThreadMessageInTransaction,
  listQueuedThreadMessages,
  releaseQueuedMessageClaim,
} from "../queued-messages";
import type {
  ClaimedQueuedThreadMessageKey,
  ClaimedQueuedThreadMessageRow,
  CreateQueuedThreadMessageInput,
  QueuedThreadMessageRow,
} from "../queued-messages";
import { createThread } from "../threads";
import { openTempDb } from "./open-temp-db";

// each in the transaction the server composes it in.
const enqueue = (
  db: DbConnection,
  input: Omit<CreateQueuedThreadMessageInput, "contextPaths" | "dispatchId" | "preset">,
): QueuedThreadMessageRow =>
  writeTransaction(db, (tx) =>
    createQueuedThreadMessageInTransaction(tx, {
      ...input,
      contextPaths: null,
      dispatchId: null,
      preset: null,
    }),
  );

const claimNext = (db: DbConnection, threadId: string): ClaimedQueuedThreadMessageRow | null =>
  writeTransaction(db, (tx) => claimNextQueuedThreadMessageInTransaction(tx, threadId));

const deleteClaimed = (db: DbConnection, key: ClaimedQueuedThreadMessageKey): boolean =>
  writeTransaction(db, (tx) => deleteClaimedQueuedThreadMessageInTransaction(tx, key));

describe("queued thread messages", () => {
  it("claims in arrival order, one holder per message", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const first = enqueue(db, {
      text: "first",
      threadId: thread.id,
    });
    enqueue(db, { text: "second", threadId: thread.id });

    const claimed = claimNext(db, thread.id);
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.claimToken).toBeTruthy();
    expect(listQueuedThreadMessages(db, thread.id).map((row) => row.text)).toEqual(["second"]);

    const next = claimNext(db, thread.id);
    expect(next?.text).toBe("second");
    expect(claimNext(db, thread.id)).toBeNull();
  });

  it("never hands one message to two claimants across separate connections", () => {
    const db = openTempDb();
    const rival = createConnection(db.$client.name);
    const thread = createThread(db, noopNotifier, {});
    enqueue(db, { text: "one", threadId: thread.id });
    enqueue(db, { text: "two", threadId: thread.id });

    const first = claimNext(db, thread.id);
    const second = claimNext(rival, thread.id);
    expect(first?.text).toBe("one");
    expect(second?.text).toBe("two");
    expect(claimNext(rival, thread.id)).toBeNull();
    if (!first) {
      throw new Error("expected a claim");
    }
    expect(
      deleteClaimed(rival, {
        claimToken: "claim_forged",
        id: first.id,
      }),
    ).toBe(false);
  });

  it("stays FIFO across a same-millisecond burst", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const texts = Array.from({ length: 20 }, (_, index) => `message-${index}`);
    for (const text of texts) {
      enqueue(db, { text, threadId: thread.id });
    }
    expect(listQueuedThreadMessages(db, thread.id).map((row) => row.text)).toEqual(texts);
    const drained: string[] = [];
    for (;;) {
      const claimed = claimNext(db, thread.id);
      if (!claimed) {
        break;
      }
      drained.push(claimed.text);
    }
    expect(drained).toEqual(texts);
  });

  it("hands a message's attachments back as paths, and unreadable ones as none", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const attach = (contextPaths: readonly string[] | null): QueuedThreadMessageRow =>
      writeTransaction(db, (tx) =>
        createQueuedThreadMessageInTransaction(tx, {
          contextPaths,
          dispatchId: null,
          preset: null,
          text: "compare these",
          threadId: thread.id,
        }),
      );
    const attached = attach(["Notes/a.md", "Notes/b.md"]);
    const unreadable = attach(["Notes/c.md"]);
    attach(null);
    db.$client
      .prepare("UPDATE queued_thread_messages SET context_paths = ? WHERE id = ?")
      .run("Notes/c.md", unreadable.id);

    expect(attached.contextPaths).toEqual(["Notes/a.md", "Notes/b.md"]);
    expect(listQueuedThreadMessages(db, thread.id).map((row) => row.contextPaths)).toEqual([
      ["Notes/a.md", "Notes/b.md"],
      null,
      null,
    ]);
    expect(claimNext(db, thread.id)?.contextPaths).toEqual(["Notes/a.md", "Notes/b.md"]);
  });

  it("hands a message's preset back, and a name this build has no preset for as none", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const ask = (preset: "tidy-library" | null): QueuedThreadMessageRow =>
      writeTransaction(db, (tx) =>
        createQueuedThreadMessageInTransaction(tx, {
          contextPaths: null,
          dispatchId: null,
          preset,
          text: "Tidy my library",
          threadId: thread.id,
        }),
      );
    const tidy = ask("tidy-library");
    const unknown = ask("tidy-library");
    ask(null);
    db.$client
      .prepare("UPDATE queued_thread_messages SET preset = ? WHERE id = ?")
      .run("summarize-everything", unknown.id);

    expect(tidy.preset).toBe("tidy-library");
    expect(listQueuedThreadMessages(db, thread.id).map((row) => row.preset)).toEqual([
      "tidy-library",
      null,
      null,
    ]);
    expect(claimNext(db, thread.id)?.preset).toBe("tidy-library");
  });

  it("release puts a claim back; delete needs the claim token", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    enqueue(db, { text: "only", threadId: thread.id });

    const claimed = claimNext(db, thread.id);
    if (!claimed) {
      throw new Error("expected a claim");
    }
    expect(
      deleteClaimed(db, {
        claimToken: "claim_wrong",
        id: claimed.id,
      }),
    ).toBe(false);

    expect(releaseQueuedMessageClaim(db, noopNotifier, claimed)).toBe(true);
    expect(listQueuedThreadMessages(db, thread.id)).toHaveLength(1);

    const reclaimed = claimNext(db, thread.id);
    if (!reclaimed) {
      throw new Error("expected a reclaim");
    }
    expect(reclaimed.claimToken).not.toBe(claimed.claimToken);
    expect(deleteClaimed(db, reclaimed)).toBe(true);
    expect(listQueuedThreadMessages(db, thread.id)).toHaveLength(0);
  });
});

const APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { command: "ls", cwd: null, itemId: "item_1", kind: "command" },
};

describe("pending interactions", () => {
  it("is idempotent on the provider request key", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const created = createPendingInteraction(db, noopNotifier, {
      payload: APPROVAL,
      requestKey: "req-1",
      threadId: thread.id,
    });
    const replayed = createPendingInteraction(db, noopNotifier, {
      payload: { ...APPROVAL, reason: "a retry" },
      requestKey: "req-1",
      threadId: thread.id,
    });
    expect(replayed.id).toBe(created.id);
    expect(replayed.payload).toEqual(APPROVAL);
    expect(listOpenPendingInteractions(db, thread.id)).toHaveLength(1);
  });

  it("reads a payload the grammar refuses as null, and the rows beside it whole", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const unreadable = createPendingInteraction(db, noopNotifier, {
      payload: APPROVAL,
      requestKey: "req-1",
      threadId: thread.id,
    });
    createPendingInteraction(db, noopNotifier, {
      payload: APPROVAL,
      requestKey: "req-2",
      threadId: thread.id,
    });
    db.$client
      .prepare("UPDATE pending_interactions SET payload = ? WHERE id = ?")
      .run('{"kind":"approval","subject":{"kind":"network"}}', unreadable.id);

    expect(getPendingInteraction(db, unreadable.id)?.payload).toBeNull();
    // both rows can share a createdAt millisecond, and then their random ids decide the order
    const payloadByRequest = Object.fromEntries(
      listOpenPendingInteractions(db, thread.id).map((row) => [row.requestKey, row.payload]),
    );
    expect(payloadByRequest).toEqual({ "req-1": null, "req-2": APPROVAL });
  });

  it("resolves exactly once", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const interaction = createPendingInteraction(db, noopNotifier, {
      payload: APPROVAL,
      requestKey: "req-1",
      threadId: thread.id,
    });

    const resolved = resolvePendingInteraction(db, noopNotifier, {
      decision: "allow_once",
      id: interaction.id,
      threadId: thread.id,
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind === "resolved") {
      expect(resolved.interaction.status).toBe("resolved");
      expect(resolved.interaction.decision).toBe("allow_once");
    }
    expect(listOpenPendingInteractions(db, thread.id)).toHaveLength(0);

    const again = resolvePendingInteraction(db, noopNotifier, {
      decision: "deny",
      id: interaction.id,
      threadId: thread.id,
    });
    expect(again.kind).toBe("already-resolved");

    const missing = resolvePendingInteraction(db, noopNotifier, {
      decision: "allow_once",
      id: "pint_missing",
      threadId: thread.id,
    });
    expect(missing.kind).toBe("not-found");
  });
});
