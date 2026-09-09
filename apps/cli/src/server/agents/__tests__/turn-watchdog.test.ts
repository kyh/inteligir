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
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { TurnDriver } from "../../threads/turn-driver";
import type { GitEngine } from "../../vault/git-engine";
import { createAcpRuntimeManager } from "../runtime-manager";
import type { AcpRuntimeManager } from "../runtime-manager";
import { makeTempDir } from "../../__tests__/temp-dir";
import { fakeSessionFacts } from "./agent-test-harness";

const BUDGET_MS = 200;
const PROVIDER_TURN_ID = "pturn_1";

afterEach(() => {
  vi.useRealTimers();
});

const fakeGitEngine = (): GitEngine => ({
  commitNow: async () => await Promise.resolve(null),
  commitPaths: async () => await Promise.resolve(null),
  deleted: async () => await Promise.resolve([]),
  dispose: async () => {
    await Promise.resolve();
  },
  history: async () => await Promise.resolve([]),
  holdCommits: () => () => {},
  isSyncing: () => false,
  revision: async () => await Promise.resolve(""),
  runExclusive: async (work) => await work(),
  scheduleCommit: () => {},
  startAutoSync: () => {},
  status: async () =>
    await Promise.resolve({ lastError: null, lastSyncAt: null, state: "no-remote" }),
  syncNow: async () =>
    await Promise.resolve({ lastError: null, lastSyncAt: null, state: "no-remote" }),
});

const fakeAgentRuntime = (): AgentRuntime => ({
  hasThread: () => true,
  reapIdleProviderSessions: async () => await Promise.resolve({ reapedSessions: [] }),
  resumeThread: async () => await Promise.resolve({ providerThreadId: "pt_1" }),
  runTurn: async () => {
    await Promise.resolve();
  },
  shutdown: async () => {
    await Promise.resolve();
  },
  startThread: async () => await Promise.resolve({ providerThreadId: "pt_1" }),
});

interface Harness {
  db: DbConnection;
  threadId: string;
  driver: TurnDriver;
  manager: AcpRuntimeManager;
  ingested: ThreadEvent[];
  runtimeOptions: () => AcpAgentRuntimeOptions;
}

const makeHarness = (): Harness => {
  const db = createConnection(path.join(makeTempDir("inteligir-watchdog-"), "test.db"));
  runMigrations(db);
  const threadId = createThread(db, noopNotifier, {}).id;
  const ingested: ThreadEvent[] = [];
  let captured: AcpAgentRuntimeOptions | null = null;
  const manager = createAcpRuntimeManager({
    createRuntime: (options) => {
      captured = options;
      return fakeAgentRuntime();
    },
    db,
    defaultProviderId: () => "claude",
    git: fakeGitEngine(),
    hostEnv: {},
    mcpServers: () => [],
    model: null,
    notifier: noopNotifier,
    reapIntervalMs: null,
    sessionFacts: () => fakeSessionFacts(),
    turnIdleTimeoutMs: BUDGET_MS,
    vaultDir: makeTempDir("inteligir-watchdog-vault-"),
  });
  const driver = manager.createTurnDriver({
    ingestProviderEvents: (_threadId, events) => {
      ingested.push(...events);
    },
  });
  onTestFinished(async () => {
    await manager.dispose();
  });
  onTestFinished(() => {
    closeConnection(db);
  });
  return {
    db,
    driver,
    ingested,
    manager,
    runtimeOptions: () => {
      if (captured === null) {
        throw new Error("no turn was dispatched, so no runtime was built");
      }
      return captured;
    },
    threadId,
  };
};

const turnFailed = (ingested: readonly ThreadEvent[]): boolean =>
  ingested.some((event) => event.type === "turn/completed" && event.status === "failed");

const providerFrame = (threadId: string, delta: string): ProviderEvent => ({
  delta,
  itemId: "item_1",
  providerThreadId: "pt_1",
  scope: turnScope(PROVIDER_TURN_ID),
  threadId,
  type: "item/agentMessage/delta",
});

const startSilentTurn = async (harness: Harness): Promise<void> => {
  harness.driver.startTurn({ text: "go", threadId: harness.threadId, turnId: "turn_1" });
  // let the dispatch settle onto the fake runtime before the clock advances.
  await vi.advanceTimersByTimeAsync(0);
  harness.runtimeOptions().onEvent({
    providerThreadId: "pt_1",
    scope: turnScope(PROVIDER_TURN_ID),
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
      payload: {
        availableDecisions: ["allow_once", "deny"],
        kind: "approval",
        reason: null,
        subject: { command: "ls", cwd: null, itemId: "cmd_1", kind: "command" },
      },
      providerId: "claude",
      providerRequestId: "req-1",
      providerThreadId: "pt_1",
      threadId: harness.threadId,
      turnId: PROVIDER_TURN_ID,
    });

    await vi.advanceTimersByTimeAsync(BUDGET_MS * 4);
    expect(turnFailed(harness.ingested)).toBe(false);

    const [row] = listOpenPendingInteractions(harness.db, harness.threadId);
    if (row === undefined) {
      throw new Error("expected the parked row");
    }
    harness.driver.onInteractionResolved?.({
      createdAt: 0,
      id: row.id,
      payload: null,
      requestKey: row.requestKey,
      resolution: "allow_once",
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
