import { createConnection } from "../connection";
import { describe, expect, it } from "vitest";
import { noopNotifier } from "@repo/domain/notifier";
import {
  createPendingInteraction,
  listOpenPendingInteractions,
  resolvePendingInteraction,
} from "../pending-interactions";
import {
  claimNextQueuedThreadMessage,
  createQueuedThreadMessage,
  deleteClaimedQueuedThreadMessage,
  listQueuedThreadMessages,
  releaseQueuedMessageClaim,
} from "../queued-messages";
import { createThread } from "../threads";
import { openTempDb } from "./open-temp-db";

describe("queued thread messages", () => {
  it("claims in arrival order, one holder per message", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const first = createQueuedThreadMessage(db, noopNotifier, {
      threadId: thread.id,
      text: "first",
    });
    createQueuedThreadMessage(db, noopNotifier, { threadId: thread.id, text: "second" });

    const claimed = claimNextQueuedThreadMessage(db, noopNotifier, thread.id);
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.claimToken).toBeTruthy();
    expect(listQueuedThreadMessages(db, thread.id).map((row) => row.text)).toEqual(["second"]);

    const next = claimNextQueuedThreadMessage(db, noopNotifier, thread.id);
    expect(next?.text).toBe("second");
    expect(claimNextQueuedThreadMessage(db, noopNotifier, thread.id)).toBeNull();
  });

  it("never hands one message to two claimants across separate connections", () => {
    const db = openTempDb();
    const rival = createConnection(db.$client.name);
    const thread = createThread(db, noopNotifier, {});
    createQueuedThreadMessage(db, noopNotifier, { threadId: thread.id, text: "one" });
    createQueuedThreadMessage(db, noopNotifier, { threadId: thread.id, text: "two" });

    const first = claimNextQueuedThreadMessage(db, noopNotifier, thread.id);
    const second = claimNextQueuedThreadMessage(rival, noopNotifier, thread.id);
    expect(first?.text).toBe("one");
    expect(second?.text).toBe("two");
    expect(claimNextQueuedThreadMessage(rival, noopNotifier, thread.id)).toBeNull();
    if (!first) {
      throw new Error("expected a claim");
    }
    expect(
      deleteClaimedQueuedThreadMessage(rival, noopNotifier, {
        id: first.id,
        claimToken: "claim_forged",
      }),
    ).toBe(false);
  });

  it("stays FIFO across a same-millisecond burst", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const texts = Array.from({ length: 20 }, (_, index) => `message-${index}`);
    for (const text of texts) {
      createQueuedThreadMessage(db, noopNotifier, { threadId: thread.id, text });
    }
    expect(listQueuedThreadMessages(db, thread.id).map((row) => row.text)).toEqual(texts);
    const drained: string[] = [];
    for (;;) {
      const claimed = claimNextQueuedThreadMessage(db, noopNotifier, thread.id);
      if (!claimed) {
        break;
      }
      drained.push(claimed.text);
    }
    expect(drained).toEqual(texts);
  });

  it("release puts a claim back; delete needs the claim token", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    createQueuedThreadMessage(db, noopNotifier, { threadId: thread.id, text: "only" });

    const claimed = claimNextQueuedThreadMessage(db, noopNotifier, thread.id);
    if (!claimed) {
      throw new Error("expected a claim");
    }
    expect(
      deleteClaimedQueuedThreadMessage(db, noopNotifier, {
        id: claimed.id,
        claimToken: "claim_wrong",
      }),
    ).toBe(false);

    expect(releaseQueuedMessageClaim(db, noopNotifier, claimed)).toBe(true);
    expect(listQueuedThreadMessages(db, thread.id)).toHaveLength(1);

    const reclaimed = claimNextQueuedThreadMessage(db, noopNotifier, thread.id);
    if (!reclaimed) {
      throw new Error("expected a reclaim");
    }
    expect(reclaimed.claimToken).not.toBe(claimed.claimToken);
    expect(deleteClaimedQueuedThreadMessage(db, noopNotifier, reclaimed)).toBe(true);
    expect(listQueuedThreadMessages(db, thread.id)).toHaveLength(0);
  });
});

describe("pending interactions", () => {
  it("is idempotent on the provider request key", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const created = createPendingInteraction(db, noopNotifier, {
      threadId: thread.id,
      requestKey: "req-1",
      payload: JSON.stringify({ kind: "approval" }),
    });
    const replayed = createPendingInteraction(db, noopNotifier, {
      threadId: thread.id,
      requestKey: "req-1",
      payload: JSON.stringify({ kind: "approval-retry" }),
    });
    expect(replayed.id).toBe(created.id);
    expect(replayed.payload).toBe(created.payload);
    expect(listOpenPendingInteractions(db, thread.id)).toHaveLength(1);
  });

  it("resolves exactly once", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const interaction = createPendingInteraction(db, noopNotifier, {
      threadId: thread.id,
      requestKey: "req-1",
      payload: "{}",
    });

    const resolved = resolvePendingInteraction(db, noopNotifier, {
      id: interaction.id,
      threadId: thread.id,
      resolution: "allow",
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind === "resolved") {
      expect(resolved.interaction.status).toBe("resolved");
      expect(resolved.interaction.resolution).toBe("allow");
    }
    expect(listOpenPendingInteractions(db, thread.id)).toHaveLength(0);

    const again = resolvePendingInteraction(db, noopNotifier, {
      id: interaction.id,
      threadId: thread.id,
      resolution: "deny",
    });
    expect(again.kind).toBe("already-resolved");

    const missing = resolvePendingInteraction(db, noopNotifier, {
      id: "pint_missing",
      threadId: thread.id,
      resolution: "allow",
    });
    expect(missing.kind).toBe("not-found");
  });
});
