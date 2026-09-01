// The waiters over a real database and NO child process: what these cases
// pin is the park/resolve/cancel contract on its own — row creation
// idempotent on the request key, the timeout deny that interrupts the row,
// and the settle hook the turn watchdog restarts its clock from.

import { join } from "node:path";
import { closeConnection, createConnection, type DbConnection } from "@repo/db/connection";
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
  PendingInteractionCreate,
} from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInteractionWaiters,
  INTERACTION_TIMEOUT_MS,
  type InteractionWaiters,
} from "../interaction-waiters";
import { makeTempDir } from "../../__tests__/temp-dir";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.useRealTimers();
});

const APPROVAL_PAYLOAD: ApprovalPendingInteractionPayload = {
  kind: "approval",
  subject: { kind: "command", itemId: "cmd_1", command: "ls", cwd: null },
  reason: null,
  availableDecisions: ["allow_once", "deny"],
};

interface Harness {
  db: DbConnection;
  threadId: string;
  waiters: InteractionWaiters;
  settledThreads: string[];
  debugLines: string[];
}

function makeHarness(): Harness {
  const db = createConnection(join(makeTempDir("inteligir-waiters-"), "test.db"));
  runMigrations(db);
  cleanups.push(() => {
    closeConnection(db);
  });
  const threadId = createThread(db, noopNotifier, {}).id;
  const settledThreads: string[] = [];
  const debugLines: string[] = [];
  const waiters = createInteractionWaiters({
    db,
    notifier: noopNotifier,
    debug: (message) => debugLines.push(message),
    onWaitSettled: (settled) => settledThreads.push(settled),
  });
  return { db, threadId, waiters, settledThreads, debugLines };
}

function requestFor(threadId: string, requestKey = "req-1"): PendingInteractionCreate {
  return {
    threadId,
    turnId: "pturn_1",
    providerId: "claude",
    providerThreadId: "pt_1",
    providerRequestId: requestKey,
    payload: APPROVAL_PAYLOAD,
  };
}

function resolvedRow(id: string, threadId: string, resolution: string): PendingInteraction {
  return {
    id,
    threadId,
    turnId: null,
    requestKey: "req-1",
    status: "resolved",
    payload: APPROVAL_PAYLOAD,
    resolution,
    createdAt: 0,
    resolvedAt: 0,
  };
}

describe("createInteractionWaiters", () => {
  it("parks the provider on the row and answers it from the recorded resolution", async () => {
    const { db, threadId, waiters, settledThreads } = makeHarness();
    const parked = waiters.park(requestFor(threadId), "turn_host");

    const row = listOpenPendingInteractions(db, threadId)[0];
    expect(row).toMatchObject({ requestKey: "req-1", turnId: "turn_host", status: "pending" });
    if (row === undefined) throw new Error("expected the parked row");
    expect(waiters.hasParked(threadId)).toBe(true);

    waiters.resolve(resolvedRow(row.id, threadId, "allow_once"));
    await expect(parked).resolves.toEqual({ decision: "allow_once" });
    expect(waiters.hasParked(threadId)).toBe(false);
    // The provider is free to work again: the watchdog clock restarts here.
    expect(settledThreads).toEqual([threadId]);
  });

  it("denies an unparseable resolution rather than passing it through", async () => {
    const { db, threadId, waiters, debugLines } = makeHarness();
    const parked = waiters.park(requestFor(threadId), null);
    const row = listOpenPendingInteractions(db, threadId)[0];
    if (row === undefined) throw new Error("expected the parked row");

    waiters.resolve(resolvedRow(row.id, threadId, "approve!!"));
    await expect(parked).resolves.toEqual({ decision: "deny" });
    expect(debugLines.some((line) => line.includes("unparseable"))).toBe(true);
  });

  it("times out onto a deny, interrupting the row and restarting the clock", async () => {
    vi.useFakeTimers();
    const { db, threadId, waiters, settledThreads } = makeHarness();
    const parked = waiters.park(requestFor(threadId), null);
    const row = listOpenPendingInteractions(db, threadId)[0];
    if (row === undefined) throw new Error("expected the parked row");

    await vi.advanceTimersByTimeAsync(INTERACTION_TIMEOUT_MS);
    await expect(parked).resolves.toEqual({ decision: "deny" });
    expect(getPendingInteraction(db, row.id)?.status).toBe("interrupted");
    expect(settledThreads).toEqual([threadId]);
  });

  it("answers a row the store already resolved without parking anything", async () => {
    const { db, threadId, waiters } = makeHarness();
    const first = waiters.park(requestFor(threadId), null);
    const row = listOpenPendingInteractions(db, threadId)[0];
    if (row === undefined) throw new Error("expected the parked row");
    waiters.resolve(resolvedRow(row.id, threadId, "deny"));
    await first;

    // The answer route resolves the ROW before the driver is told; a provider
    // retry with the same request key must read that answer, not park again.
    resolvePendingInteraction(db, noopNotifier, {
      id: row.id,
      threadId,
      resolution: "allow_once",
    });
    await expect(waiters.park(requestFor(threadId), null)).resolves.toEqual({
      decision: "allow_once",
    });
    expect(waiters.hasParked(threadId)).toBe(false);
  });

  it("cancel denies one thread's parked approvals and leaves the other's", async () => {
    const { db, threadId, waiters } = makeHarness();
    const otherThreadId = createThread(db, noopNotifier, {}).id;
    const mine = waiters.park(requestFor(threadId), null);
    const other = waiters.park(requestFor(otherThreadId, "req-2"), null);

    waiters.cancel(threadId);
    await expect(mine).resolves.toEqual({ decision: "deny" });
    expect(waiters.hasParked(threadId)).toBe(false);
    expect(waiters.hasParked(otherThreadId)).toBe(true);

    waiters.cancel();
    await expect(other).resolves.toEqual({ decision: "deny" });
    expect(waiters.hasParked(otherThreadId)).toBe(false);
  });
});
