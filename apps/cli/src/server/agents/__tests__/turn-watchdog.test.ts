import path from "node:path";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import { closeConnection, createConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { listOpenPendingInteractions } from "@repo/db/pending-interactions";
import { createThread } from "@repo/db/threads";
import { noopNotifier } from "@repo/domain/notifier";
import type { PendingInteractionCreate } from "@repo/domain/pending-interactions";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { ProviderEventSink } from "../../threads/turn-driver";
import type { GitEngine } from "../../vault/git-engine";
import { AcpTurnDriver } from "../runtime-manager";
import { makeTempDir } from "../../__tests__/temp-dir";
import { fakeSessionFacts } from "./agent-test-harness";

const BUDGET_MS = 200;
const TURN_ID = "turn_1";

afterEach(() => {
  vi.useRealTimers();
});

const fakeGitEngine = (): GitEngine => ({
  checkpointUnclaimed: async () => await Promise.resolve(null),
  claimedPaths: () => [],
  currentRemote: async () => await Promise.resolve(null),
  commitNow: async () => await Promise.resolve(null),
  commitPaths: async () => await Promise.resolve(null),
  deleted: async () => await Promise.resolve([]),
  dispose: async () => {
    await Promise.resolve();
  },
  history: async () => await Promise.resolve([]),
  holdCommits: () => ({ claim: () => {}, release: () => {} }),
  isSyncing: () => false,
  revision: async () => await Promise.resolve(""),
  runExclusive: async (work) => await work(),
  scheduleCommit: () => {},
  setOrigin: async () => await Promise.resolve("set"),
  startAutoSync: () => {},
  status: async () =>
    await Promise.resolve({
      conflicts: [],
      device: "Test Mac",
      externalSync: null,
      lastError: null,
      lastSyncAt: null,
      state: "no-remote",
    }),
  syncNow: async () =>
    await Promise.resolve({
      conflicts: [],
      device: "Test Mac",
      externalSync: null,
      lastError: null,
      lastSyncAt: null,
      state: "no-remote",
    }),
  turnCommits: async () => await Promise.resolve([]),
});

const fakeAgentRuntime = (timeline: string[], overrides: Partial<AgentRuntime>): AgentRuntime => ({
  cancelTurn: async (threadId) => {
    timeline.push(`cancelTurn ${threadId}`);
    await Promise.resolve();
  },
  closeThread: async (threadId) => {
    timeline.push(`closeThread ${threadId}`);
    await Promise.resolve();
  },
  hasThread: () => true,
  resumeThread: async () => await Promise.resolve({ loaded: true, providerThreadId: "pt_1" }),
  runTurn: async () => {
    await Promise.resolve();
  },
  shutdown: async () => {
    await Promise.resolve();
  },
  startThread: async () => await Promise.resolve({ providerThreadId: "pt_1" }),
  ...overrides,
});

interface Harness {
  db: DbConnection;
  threadId: string;
  driver: AcpTurnDriver;
  ingested: ThreadEvent[];
  // the runtime's closes and the ingested event types, in the order they happened.
  timeline: string[];
  runtimeOptions: () => AcpAgentRuntimeOptions;
}

const makeHarness = (runtime: Partial<AgentRuntime> = {}): Harness => {
  const db = createConnection(path.join(makeTempDir("inteligir-watchdog-"), "test.db"));
  runMigrations(db);
  const threadId = createThread(db, noopNotifier, {}).id;
  const ingested: ThreadEvent[] = [];
  const timeline: string[] = [];
  let captured: AcpAgentRuntimeOptions | null = null;
  const sink: ProviderEventSink = {
    ingestProviderEvents: (_threadId, events) => {
      ingested.push(...events);
      timeline.push(...events.map((event) => event.type));
    },
  };
  const driver = new AcpTurnDriver(sink, {
    createRuntime: (options) => {
      captured = options;
      return fakeAgentRuntime(timeline, runtime);
    },
    db,
    defaultProviderId: () => "claude",
    git: fakeGitEngine(),
    hostEnv: {},
    models: { claude: null, codex: null },
    notifier: noopNotifier,
    sessionFacts: () => fakeSessionFacts(),
    turnIdleTimeoutMs: BUDGET_MS,
    vaultDir: makeTempDir("inteligir-watchdog-vault-"),
  });
  onTestFinished(async () => {
    await driver.dispose();
  });
  onTestFinished(() => {
    closeConnection(db);
  });
  return {
    db,
    driver,
    ingested,
    runtimeOptions: () => {
      if (captured === null) {
        throw new Error("the driver never built its runtime");
      }
      return captured;
    },
    threadId,
    timeline,
  };
};

const turnFailed = (ingested: readonly ThreadEvent[]): boolean =>
  ingested.some((event) => event.type === "turn/completed" && event.status === "failed");

const providerFrame = (threadId: string, delta: string): ProviderEvent => ({
  delta,
  itemId: "item_1",
  scope: turnScope(TURN_ID),
  threadId,
  type: "item/agentMessage/delta",
});

const approvalFor = (threadId: string, turnId: string): PendingInteractionCreate => ({
  payload: {
    availableDecisions: ["allow_once", "deny"],
    kind: "approval",
    reason: null,
    subject: { command: "ls", cwd: null, itemId: "cmd_1", kind: "command" },
  },
  providerRequestId: "req-1",
  threadId,
  turnId,
});

const startSilentTurn = async (harness: Harness): Promise<void> => {
  harness.driver.startTurn({ text: "go", threadId: harness.threadId, turnId: TURN_ID });
  // let the dispatch settle onto the fake runtime before the clock advances.
  await vi.advanceTimersByTimeAsync(0);
  harness.runtimeOptions().onEvent({
    scope: turnScope(TURN_ID),
    threadId: harness.threadId,
    type: "turn/started",
  });
};

describe("the silent-turn watchdog", () => {
  it("fails a turn that outgrows the budget, through the ordinary grammar", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await startSilentTurn(harness);

    await vi.advanceTimersByTimeAsync(BUDGET_MS * 2);

    expect(turnFailed(harness.ingested)).toBe(true);
    const completed = harness.ingested.find((event) => event.type === "turn/completed");
    expect(completed).toMatchObject({ scope: turnScope(TURN_ID) });
    const failure = harness.ingested.find((event) => event.type === "provider/error");
    expect(failure).toMatchObject({ failure: "other", scope: turnScope(TURN_ID) });
    expect(failure?.type === "provider/error" ? failure.message : "").toContain(
      `produced nothing for ${BUDGET_MS}ms`,
    );
  });

  it("closes the provider session before the fail, so no later turn is sent to it", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await startSilentTurn(harness);

    await vi.advanceTimersByTimeAsync(BUDGET_MS * 2);

    const closed = harness.timeline.indexOf(`closeThread ${harness.threadId}`);
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(closed).toBeLessThan(harness.timeline.indexOf("turn/completed"));
  });

  it("measures SILENCE, not duration: every frame restarts the clock", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await startSilentTurn(harness);

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
    const parked = request(approvalFor(harness.threadId, TURN_ID));

    await vi.advanceTimersByTimeAsync(BUDGET_MS * 4);
    expect(turnFailed(harness.ingested)).toBe(false);

    const [row] = listOpenPendingInteractions(harness.db, harness.threadId);
    if (row === undefined) {
      throw new Error("expected the parked row");
    }
    harness.driver.onInteractionResolved?.({
      createdAt: 0,
      decision: "allow_once",
      id: row.id,
      payload: null,
      requestKey: row.requestKey,
      resolvedAt: 0,
      status: "resolved",
      threadId: harness.threadId,
      turnId: null,
    });
    await expect(parked).resolves.toEqual({ decision: "allow_once" });

    await vi.advanceTimersByTimeAsync(BUDGET_MS / 2);
    expect(turnFailed(harness.ingested)).toBe(false);
    await vi.advanceTimersByTimeAsync(BUDGET_MS * 2);
    expect(turnFailed(harness.ingested)).toBe(true);
  });
});

describe("an approval naming a turn that is not the running one", () => {
  it("is denied without a card, since no settle is left to clear one", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await startSilentTurn(harness);

    const request = harness.runtimeOptions().onInteractiveRequest;
    if (request === undefined) {
      throw new Error("the driver registered no interaction inlet");
    }
    await expect(request(approvalFor(harness.threadId, "turn_settled"))).resolves.toEqual({
      decision: "deny",
    });
    expect(listOpenPendingInteractions(harness.db, harness.threadId)).toEqual([]);
  });
});

describe("a stop before the provider started the turn", () => {
  it("withdraws the turn, closes what the dispatch was opening, and prompts nothing", async () => {
    vi.useFakeTimers();
    const opening: PromiseWithResolvers<{ providerThreadId: string }>[] = [];
    const prompted: string[] = [];
    const harness = makeHarness({
      hasThread: () => false,
      runTurn: async (args) => {
        prompted.push(args.threadId);
      },
      startThread: async () => {
        const open = Promise.withResolvers<{ providerThreadId: string }>();
        opening.push(open);
        return await open.promise;
      },
    });
    harness.driver.startTurn({ text: "go", threadId: harness.threadId, turnId: "turn_1" });
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.driver.interruptTurn(harness.threadId)).toBe("not-running");
    expect(harness.timeline).toEqual([`closeThread ${harness.threadId}`]);

    const [open] = opening;
    open?.resolve({ providerThreadId: "pt_1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(prompted).toEqual([]);
    expect(harness.ingested).toEqual([]);
    expect(harness.driver.interruptTurn(harness.threadId)).toBe("not-running");
  });
});

describe("a dispatch that outlives its turn", () => {
  it("fails nothing once the turn it was dispatching has been replaced", async () => {
    vi.useFakeTimers();
    const opening: PromiseWithResolvers<{ providerThreadId: string }>[] = [];
    const harness = makeHarness({
      hasThread: () => false,
      startThread: async () => {
        const open = Promise.withResolvers<{ providerThreadId: string }>();
        opening.push(open);
        return await open.promise;
      },
    });
    harness.driver.startTurn({ text: "stuck", threadId: harness.threadId, turnId: "turn_1" });
    await vi.advanceTimersByTimeAsync(BUDGET_MS * 2);
    expect(turnFailed(harness.ingested)).toBe(true);

    harness.driver.startTurn({ text: "again", threadId: harness.threadId, turnId: "turn_2" });
    await vi.advanceTimersByTimeAsync(0);
    const [stale] = opening;
    if (stale === undefined || opening.length !== 2) {
      throw new Error("expected both dispatches to be opening a session");
    }
    stale.reject(new Error("the stuck session/new finally refused"));
    await vi.advanceTimersByTimeAsync(0);

    const completed = harness.ingested.filter((event) => event.type === "turn/completed");
    expect(completed).toEqual([expect.objectContaining({ scope: turnScope("turn_1") })]);
  });
});
