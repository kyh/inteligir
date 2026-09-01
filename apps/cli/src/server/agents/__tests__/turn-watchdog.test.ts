// The silent-turn watchdog with NO child process: the runtime construction
// seam hands back a fake, so what these cases pin is the sweep's own
// arithmetic — silence measured against the budget, any provider frame
// resetting the clock, and a parked approval exempting its thread until the
// answer restarts the count.

import { join } from "node:path";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import { closeConnection, createConnection, type DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { listOpenPendingInteractions } from "@repo/db/pending-interactions";
import { createThread } from "@repo/db/threads";
import { noopNotifier } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnDriver } from "../../threads/turn-driver";
import type { GitEngine } from "../../vault/git-engine";
import { createAcpRuntimeManager, type AcpRuntimeManager } from "../runtime-manager";
import { makeTempDir } from "../../__tests__/temp-dir";
import { fakeSessionFacts } from "./agent-test-harness";

const BUDGET_MS = 200;
const PROVIDER_TURN_ID = "pturn_1";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
  vi.useRealTimers();
});

/** The engine surface a turn's write set touches, with no repo behind it. */
function fakeGitEngine(): GitEngine {
  return {
    scheduleCommit: () => undefined,
    commitNow: () => Promise.resolve(null),
    commitPaths: () => Promise.resolve(null),
    holdCommits: () => () => undefined,
    history: () => Promise.resolve([]),
    revision: () => Promise.resolve(""),
    syncNow: () => Promise.resolve({ state: "no-remote", lastSyncAt: null, lastError: null }),
    status: () => Promise.resolve({ state: "no-remote", lastSyncAt: null, lastError: null }),
    isSyncing: () => false,
    runExclusive: (work) => work(),
    startAutoSync: () => undefined,
    dispose: () => Promise.resolve(),
  };
}

/** A provider that accepts every turn and then says nothing on its own. */
function fakeAgentRuntime(): AgentRuntime {
  return {
    startThread: () => Promise.resolve({ providerThreadId: "pt_1" }),
    resumeThread: () => Promise.resolve({ providerThreadId: "pt_1" }),
    runTurn: () => Promise.resolve(),
    reapIdleProviderSessions: () => Promise.resolve({ reapedSessions: [] }),
    hasThread: () => true,
    shutdown: () => Promise.resolve(),
  };
}

interface Harness {
  db: DbConnection;
  threadId: string;
  driver: TurnDriver;
  manager: AcpRuntimeManager;
  ingested: ThreadEvent[];
  /** The options the driver handed the (fake) runtime — the event and
   *  interaction inlets a real provider would speak through. */
  runtimeOptions: () => AcpAgentRuntimeOptions;
}

function makeHarness(): Harness {
  const db = createConnection(join(makeTempDir("inteligir-watchdog-"), "test.db"));
  runMigrations(db);
  const threadId = createThread(db, noopNotifier, {}).id;
  const ingested: ThreadEvent[] = [];
  let captured: AcpAgentRuntimeOptions | null = null;
  const manager = createAcpRuntimeManager({
    db,
    notifier: noopNotifier,
    vaultDir: makeTempDir("inteligir-watchdog-vault-"),
    git: fakeGitEngine(),
    model: null,
    sessionFacts: () => fakeSessionFacts(),
    hostEnv: {},
    defaultProviderId: "claude",
    mcpServers: () => [],
    createRuntime: (options) => {
      captured = options;
      return fakeAgentRuntime();
    },
    reapIntervalMs: null,
    turnIdleTimeoutMs: BUDGET_MS,
  });
  const driver = manager.createTurnDriver({
    ingestProviderEvents: (_threadId, events) => {
      ingested.push(...events);
    },
  });
  cleanups.push(() => manager.dispose());
  cleanups.push(() => {
    closeConnection(db);
  });
  return {
    db,
    threadId,
    driver,
    manager,
    ingested,
    runtimeOptions: () => {
      if (captured === null) {
        throw new Error("no turn was dispatched, so no runtime was built");
      }
      return captured;
    },
  };
}

function turnFailed(ingested: readonly ThreadEvent[]): boolean {
  return ingested.some((event) => event.type === "turn/completed" && event.status === "failed");
}

function providerFrame(threadId: string, delta: string): ProviderEvent {
  return {
    type: "item/agentMessage/delta",
    threadId,
    providerThreadId: "pt_1",
    scope: turnScope(PROVIDER_TURN_ID),
    itemId: "item_1",
    delta,
  };
}

async function startSilentTurn(harness: Harness): Promise<void> {
  harness.driver.startTurn({ threadId: harness.threadId, turnId: "turn_1", text: "go" });
  // Let the dispatch settle onto the fake runtime before the clock advances.
  await vi.advanceTimersByTimeAsync(0);
  harness.runtimeOptions().onEvent({
    type: "turn/started",
    threadId: harness.threadId,
    providerThreadId: "pt_1",
    scope: turnScope(PROVIDER_TURN_ID),
  });
}

describe("the silent-turn watchdog", () => {
  it("fails a turn that outgrows the budget, through the ordinary grammar", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await startSilentTurn(harness);

    await vi.advanceTimersByTimeAsync(BUDGET_MS * 2);

    expect(turnFailed(harness.ingested)).toBe(true);
    const completed = harness.ingested.find((event) => event.type === "turn/completed");
    expect(completed).toMatchObject({ scope: { kind: "turn", turnId: "turn_1" } });
    const failure = harness.ingested.find((event) => event.type === "provider/error");
    expect(failure?.type === "provider/error" ? failure.detail : "").toContain(
      `produced nothing for ${BUDGET_MS}ms`,
    );
  });

  it("measures SILENCE, not duration: every frame restarts the clock", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await startSilentTurn(harness);

    // Three quiet-but-alive stretches, together well past the budget.
    for (let frame = 0; frame < 3; frame += 1) {
      await vi.advanceTimersByTimeAsync(BUDGET_MS / 2);
      harness.runtimeOptions().onEvent(providerFrame(harness.threadId, `t${frame} `));
    }
    expect(turnFailed(harness.ingested)).toBe(false);

    await vi.advanceTimersByTimeAsync(BUDGET_MS * 2);
    expect(turnFailed(harness.ingested)).toBe(true);
  });

  it("exempts a thread parked on an approval, and counts again from the answer", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await startSilentTurn(harness);

    const request = harness.runtimeOptions().onInteractiveRequest;
    if (request === undefined) {
      throw new Error("the driver registered no interaction inlet");
    }
    const parked = request({
      threadId: harness.threadId,
      turnId: PROVIDER_TURN_ID,
      providerId: "claude",
      providerThreadId: "pt_1",
      providerRequestId: "req-1",
      payload: {
        kind: "approval",
        subject: { kind: "command", itemId: "cmd_1", command: "ls", cwd: null },
        reason: null,
        availableDecisions: ["allow_once", "deny"],
      },
    });

    // Parked well past the budget: the wait belongs to the user.
    await vi.advanceTimersByTimeAsync(BUDGET_MS * 4);
    expect(turnFailed(harness.ingested)).toBe(false);

    const row = listOpenPendingInteractions(harness.db, harness.threadId)[0];
    if (row === undefined) {
      throw new Error("expected the parked row");
    }
    harness.driver.onInteractionResolved?.({
      id: row.id,
      threadId: harness.threadId,
      turnId: null,
      requestKey: row.requestKey,
      status: "resolved",
      payload: null,
      resolution: "allow_once",
      createdAt: 0,
      resolvedAt: 0,
    });
    await expect(parked).resolves.toEqual({ decision: "allow_once" });

    // Silence counts from the answer, not from before the park.
    await vi.advanceTimersByTimeAsync(BUDGET_MS / 2);
    expect(turnFailed(harness.ingested)).toBe(false);
    await vi.advanceTimersByTimeAsync(BUDGET_MS * 2);
    expect(turnFailed(harness.ingested)).toBe(true);
  });
});
