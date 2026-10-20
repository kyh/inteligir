import path from "node:path";
import { closeConnection, createConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import {
  getPendingInteraction,
  listOpenPendingInteractions,
  resolvePendingInteraction,
} from "@repo/db/pending-interactions";
import { createThread } from "@repo/db/threads";
import { noopNotifier } from "@repo/domain/notifier";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalDecision,
  PendingInteractionCreate,
} from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/contract/local/threads/threads-schema";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createInteractionWaiters, INTERACTION_TIMEOUT_MS } from "./interaction-waiters";
import type { InteractionWaiters } from "./interaction-waiters";
import { makeTempDir } from "../test-support/temp-dir";

afterEach(() => {
  vi.useRealTimers();
});

const APPROVAL_PAYLOAD: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { command: "ls", cwd: null, itemId: "cmd_1", kind: "command" },
};

interface Harness {
  db: DbConnection;
  threadId: string;
  waiters: InteractionWaiters;
  settledThreads: string[];
  debugLines: string[];
}

const makeHarness = (): Harness => {
  const db = createConnection(path.join(makeTempDir("inteligir-waiters-"), "test.db"));
  runMigrations(db);
  onTestFinished(() => {
    closeConnection(db);
  });
  const threadId = createThread(db, noopNotifier, {}).id;
  const settledThreads: string[] = [];
  const debugLines: string[] = [];
  const waiters = createInteractionWaiters({
    db,
    debug: (message) => {
      debugLines.push(message);
    },
    notifier: noopNotifier,
    onWaitSettled: (settled) => {
      settledThreads.push(settled);
    },
  });
  return { db, debugLines, settledThreads, threadId, waiters };
};

const requestFor = (threadId: string, requestKey = "req-1"): PendingInteractionCreate => ({
  payload: APPROVAL_PAYLOAD,
  providerRequestId: requestKey,
  threadId,
  turnId: "turn_1",
});

const resolvedRow = (
  id: string,
  threadId: string,
  decision: PendingInteractionApprovalDecision,
): PendingInteraction => ({
  createdAt: 0,
  decision,
  id,
  payload: APPROVAL_PAYLOAD,
  requestKey: "req-1",
  resolvedAt: 0,
  status: "resolved",
  threadId,
  turnId: null,
});

describe("createInteractionWaiters", () => {
  it("parks the provider on the row and answers it from the recorded decision", async () => {
    const { db, threadId, waiters, settledThreads } = makeHarness();
    const parked = waiters.park(requestFor(threadId));

    const [row] = listOpenPendingInteractions(db, threadId);
    expect(row).toMatchObject({ requestKey: "req-1", status: "pending", turnId: "turn_1" });
    if (row === undefined) {
      throw new Error("expected the parked row");
    }
    expect(waiters.hasParked(threadId)).toBe(true);

    waiters.resolve(resolvedRow(row.id, threadId, "allow_once"));
    await expect(parked).resolves.toEqual({ decision: "allow_once" });
    expect(waiters.hasParked(threadId)).toBe(false);
    expect(settledThreads).toEqual([threadId]);
  });

  it("denies a decision the request did not offer rather than passing it through", async () => {
    const { db, threadId, waiters, debugLines } = makeHarness();
    const parked = waiters.park(requestFor(threadId));
    const [row] = listOpenPendingInteractions(db, threadId);
    if (row === undefined) {
      throw new Error("expected the parked row");
    }

    waiters.resolve(resolvedRow(row.id, threadId, "allow_for_session"));
    await expect(parked).resolves.toEqual({ decision: "deny" });
    expect(debugLines.some((line) => line.includes("did not offer"))).toBe(true);
  });

  it("times out onto a deny, interrupting the row and restarting the clock", async () => {
    vi.useFakeTimers();
    const { db, threadId, waiters, settledThreads } = makeHarness();
    const parked = waiters.park(requestFor(threadId));
    const [row] = listOpenPendingInteractions(db, threadId);
    if (row === undefined) {
      throw new Error("expected the parked row");
    }

    await vi.advanceTimersByTimeAsync(INTERACTION_TIMEOUT_MS);
    await expect(parked).resolves.toEqual({ decision: "deny" });
    expect(getPendingInteraction(db, row.id)?.status).toBe("interrupted");
    expect(settledThreads).toEqual([threadId]);
  });

  it("answers a row the store already resolved without parking anything", async () => {
    const { db, threadId, waiters } = makeHarness();
    const first = waiters.park(requestFor(threadId));
    const [row] = listOpenPendingInteractions(db, threadId);
    if (row === undefined) {
      throw new Error("expected the parked row");
    }
    waiters.resolve(resolvedRow(row.id, threadId, "deny"));
    await first;

    resolvePendingInteraction(db, noopNotifier, {
      decision: "allow_once",
      id: row.id,
      threadId,
    });
    await expect(waiters.park(requestFor(threadId))).resolves.toEqual({
      decision: "allow_once",
    });
    expect(waiters.hasParked(threadId)).toBe(false);
  });

  it("cancel denies one thread's parked approvals and leaves the other's", async () => {
    const { db, threadId, waiters } = makeHarness();
    const otherThreadId = createThread(db, noopNotifier, {}).id;
    const mine = waiters.park(requestFor(threadId));
    const other = waiters.park(requestFor(otherThreadId, "req-2"));

    waiters.cancel(threadId);
    await expect(mine).resolves.toEqual({ decision: "deny" });
    expect(waiters.hasParked(threadId)).toBe(false);
    expect(waiters.hasParked(otherThreadId)).toBe(true);

    waiters.cancel();
    await expect(other).resolves.toEqual({ decision: "deny" });
    expect(waiters.hasParked(otherThreadId)).toBe(false);
  });
});
