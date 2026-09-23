// the first turn/started binds the provider's turn id to the host's; a turn-scoped event naming
// any other provider turn (a resume replay) is dropped. a turn holds the vault's commit hold, which
// defers auto-commit and blocks sync, so a provider that hangs rather than exiting is bounded by
// the watchdog rather than trusted.

import { createAcpAgentRuntime } from "@repo/agent-runtime/acp/acp-runtime";
import type {
  AcpAgentRuntimeOptions,
  AcpMcpServerConfig,
} from "@repo/agent-runtime/acp/acp-runtime";
import { HARNESSES, isHarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessDefinition, HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import { describeProviderError } from "@repo/agent-runtime/acp/provider-error";
import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import { interruptOpenPendingInteractions } from "@repo/db/pending-interactions";
import { getThread, setThreadProviderSession } from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import { messageOf } from "../error-message";
import type {
  CreateTurnDriver,
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
} from "../threads/turn-driver";
import type { GitEngine } from "../vault/git-engine";
import { beginAgentTurnWrites, createVaultPathResolver } from "./agent-commits";
import type { AgentTurnWrites, VaultPathResolver } from "./agent-commits";
import { toInstructions } from "./agent-instructions";
import { toShellEnv } from "./agent-shell-env";
import type { AgentSessionFacts } from "./agent-shell-env";
import { ProviderEventCoalescer } from "./event-coalescer";
import { mapProviderEvent } from "./event-mapping";
import { createInteractionWaiters } from "./interaction-waiters";
import type { InteractionWaiters } from "./interaction-waiters";
import { turnPromptInput } from "./view-context-prompt";

type FileChangeProviderItem = Extract<
  Extract<ProviderEvent, { type: "item/started" }>["item"],
  { type: "fileChange" }
>;

const DEFAULT_REAP_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_REAP_MS = 10 * 60_000;

// idle time, not wall time: a streaming turn is working and a parked approval has its own clock.
// what is left is a provider that accepted a turn and went silent, which no other path settles.
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 10 * 60_000;

// a sweep over per-turn timestamps: a streaming turn produces thousands of frames, and
// re-arming a timeout per frame buys nothing over a bounded-lag check.
const WATCHDOG_SWEEP_INTERVAL_MS = 1000;

export interface AcpRuntimeManagerDeps {
  db: DbConnection;
  notifier: DbNotifier;
  vaultDir: string;
  git: GitEngine;
  model: string | null;
  // a getter read at every session open, never a value: connected folders are settings-mutable,
  // and a value read once would tell every later session the set the first one saw.
  sessionFacts: () => AgentSessionFacts;
  hostEnv: NodeJS.ProcessEnv;
  // a getter: the stored default can change between two thread starts
  defaultProviderId: () => HarnessId;
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"];
  mcpServers: () => AcpMcpServerConfig[] | Promise<AcpMcpServerConfig[]>;
  createRuntime?: typeof createAcpAgentRuntime;
  // null disables.
  reapIntervalMs?: number | null;
  // null disables.
  turnIdleTimeoutMs?: number | null;
  onDebug?: (message: string) => void;
}

export interface AcpRuntimeManager {
  createTurnDriver: CreateTurnDriver;
  dispose: () => Promise<void>;
}

// the first turn/started binds the provider's turn id (null when it names none) to the host's.
type TurnPhase = { kind: "dispatched" } | { kind: "started"; providerTurnId: string | null };

// in the map from startTurn until the turn settles, so membership is the unsettled test.
interface ActiveTurn {
  ourTurnId: string;
  phase: TurnPhase;
  writes: AgentTurnWrites;
  lastEventAt: number;
}

class AcpTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: AcpRuntimeManagerDeps;
  private readonly resolveVaultPath: VaultPathResolver;
  private runtime: AgentRuntime | null = null;
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  private readonly events = new ProviderEventCoalescer((threadId, batch) => {
    this.sink.ingestProviderEvents(threadId, batch);
  });
  private readonly turnsByThreadId = new Map<string, ActiveTurn>();
  private readonly waiters: InteractionWaiters;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(sink: ProviderEventSink, deps: AcpRuntimeManagerDeps) {
    this.sink = sink;
    this.deps = deps;
    this.resolveVaultPath = createVaultPathResolver(deps.vaultDir);
    this.waiters = createInteractionWaiters({
      db: deps.db,
      debug: (message) => {
        this.debug(message);
      },
      notifier: deps.notifier,
      onWaitSettled: (threadId) => {
        this.noteTurnActivity(threadId);
      },
    });
    const budgetMs = deps.turnIdleTimeoutMs ?? DEFAULT_TURN_IDLE_TIMEOUT_MS;
    if (deps.turnIdleTimeoutMs !== null) {
      this.watchdogTimer = setInterval(
        () => {
          this.sweepIdleTurns(budgetMs);
        },
        // a budget below the sweep cadence still fails within ~2x its bound.
        Math.min(budgetMs, WATCHDOG_SWEEP_INTERVAL_MS),
      );
      this.watchdogTimer.unref();
    }
  }

  private debug(message: string): void {
    this.deps.onDebug?.(message);
  }

  private ensureRuntime(): AgentRuntime {
    if (this.disposed) {
      throw new Error("The agent runtime manager is disposed");
    }
    if (this.runtime !== null) {
      return this.runtime;
    }
    const createRuntime = this.deps.createRuntime ?? createAcpAgentRuntime;
    const runtimeOptions: AcpAgentRuntimeOptions = {
      onEvent: (event) => {
        this.onRuntimeEvent(event);
      },
      onInteractiveRequest: async (request) => await this.onInteractiveRequest(request),
      onStderr: (line) => {
        this.debug(`agent: ${line}`);
      },
      workspacePath: this.deps.vaultDir,
    };
    runtimeOptions.shellEnv = () => ({
      ...toShellEnv(this.deps.sessionFacts(), this.deps.hostEnv),
    });
    if (this.deps.model !== null) {
      runtimeOptions.model = this.deps.model;
    }
    runtimeOptions.mcpServers = this.deps.mcpServers;
    if (this.deps.spawnAdapter !== undefined) {
      runtimeOptions.spawnAdapter = this.deps.spawnAdapter;
    }
    const runtime = createRuntime(runtimeOptions);
    this.runtime = runtime;
    const { reapIntervalMs } = this.deps;
    if (reapIntervalMs !== null) {
      this.reapTimer = setInterval(() => {
        void (async () => {
          try {
            const result = await runtime.reapIdleProviderSessions({
              idleForMs: DEFAULT_IDLE_REAP_MS,
              nowMs: Date.now(),
            });
            for (const reaped of result.reapedSessions) {
              this.debug(
                `reaped idle agent session for thread ${reaped.threadId} after ${reaped.idleForMs}ms`,
              );
            }
          } catch (error) {
            this.debug(`idle session reaping failed: ${messageOf(error)}`);
          }
        })();
      }, reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS);
      this.reapTimer.unref();
    }
    return runtime;
  }

  startTurn(args: TurnDriverStartArgs): void {
    if (this.disposed) {
      throw new Error("The agent runtime manager is disposed");
    }
    if (this.turnsByThreadId.has(args.threadId)) {
      throw new Error(`Thread ${args.threadId} already has a running turn`);
    }
    this.turnsByThreadId.set(args.threadId, {
      lastEventAt: Date.now(),
      ourTurnId: args.turnId,
      phase: { kind: "dispatched" },
      writes: beginAgentTurnWrites({
        git: this.deps.git,
        threadId: args.threadId,
        turnId: args.turnId,
      }),
    });
    void this.runDispatch(args);
  }

  private async runDispatch(args: TurnDriverStartArgs): Promise<void> {
    try {
      await this.dispatchTurn(args);
    } catch (error) {
      // a disposed manager leaves its turns to the next boot's recovery; a turn the watchdog settled
      // mid-dispatch is already failed, and failing it here would fail the turn that replaced it.
      if (this.disposed || !this.isDispatching(args)) {
        this.debug(
          `dispatch of turn ${args.turnId} on thread ${args.threadId} stopped: ${describeProviderError(error)}`,
        );
        return;
      }
      // what a failed dispatch opened is not trusted either: the next send opens afresh, standing
      // instructions first.
      this.abandonProviderSession(args.threadId);
      this.failTurn(args.threadId, error);
    }
  }

  private isDispatching(args: TurnDriverStartArgs): boolean {
    return this.turnsByThreadId.get(args.threadId)?.ourTurnId === args.turnId;
  }

  // a dispatch resumes after every await into a thread that may have moved on; one whose turn was
  // settled meanwhile stops rather than opening a session or prompting a turn nobody awaits.
  private assertDispatching(args: TurnDriverStartArgs): void {
    if (!this.isDispatching(args)) {
      throw new Error(`Turn ${args.turnId} settled before its dispatch finished`);
    }
  }

  // a provider the host gave up on must not carry the settled turn into the next one.
  private abandonProviderSession(threadId: string): void {
    const { runtime } = this;
    if (runtime === null) {
      return;
    }
    void (async () => {
      try {
        await runtime.closeThread(threadId);
      } catch (error) {
        this.debug(
          `closing the provider session for thread ${threadId} failed: ${messageOf(error)}`,
        );
      }
    })();
  }

  private noteTurnActivity(threadId: string): void {
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined) {
      return;
    }
    state.lastEventAt = Date.now();
  }

  // a parked approval is exempt: that wait is the user's, and the deny its clock produces restarts this one.
  private sweepIdleTurns(budgetMs: number): void {
    if (this.disposed) {
      return;
    }
    const now = Date.now();
    for (const [threadId, state] of this.turnsByThreadId) {
      if (this.waiters.hasParked(threadId)) {
        continue;
      }
      if (now - state.lastEventAt <= budgetMs) {
        continue;
      }
      // closed before the fail, whose ingest can dispatch the next queued turn: that turn must not
      // find the silent session.
      this.abandonProviderSession(threadId);
      this.failTurn(
        threadId,
        new Error(
          `The agent produced nothing for ${budgetMs}ms; the turn was abandoned so the vault can commit and sync again`,
        ),
      );
    }
  }

  private async dispatchTurn(args: TurnDriverStartArgs): Promise<void> {
    // the hold blocks new sync passes; this waits out one already mid-flight, so the provider
    // never writes into a rebase's checkout window.
    await this.turnsByThreadId.get(args.threadId)?.writes.ready;
    this.assertDispatching(args);
    const runtime = this.ensureRuntime();
    // acp's session/new carries no instructions field, so the first turn's prompt is the only channel.
    const instructions = runtime.hasThread(args.threadId)
      ? undefined
      : await this.openThreadSession(runtime, args);
    this.assertDispatching(args);
    await runtime.runTurn({
      input: turnPromptInput(args.text, args.viewContext, instructions),
      threadId: args.threadId,
    });
  }

  private async openThreadSession(
    runtime: AgentRuntime,
    args: TurnDriverStartArgs,
  ): Promise<string | undefined> {
    const { threadId } = args;
    const instructions = toInstructions(this.deps.sessionFacts(), this.deps.vaultDir);
    const row = getThread(this.deps.db, threadId);
    const persisted = row?.providerThreadId ?? null;
    const providerId = this.providerIdOf(row);
    if (persisted !== null) {
      try {
        const resumed = await runtime.resumeThread({
          providerId,
          providerThreadId: persisted,
          threadId,
        });
        setThreadProviderSession(this.deps.db, {
          providerId,
          providerThreadId: resumed.providerThreadId,
          threadId,
        });
        return instructions;
      } catch (error) {
        // the provider's rollout can be gone (a cleaned ~/.codex, another machine); a fresh
        // session keeps the thread usable.
        this.debug(
          `resume of thread ${threadId} from provider session ${persisted} failed; starting fresh: ${describeProviderError(error)}`,
        );
      }
      this.assertDispatching(args);
    }
    const started = await runtime.startThread({ providerId, threadId });
    setThreadProviderSession(this.deps.db, {
      providerId,
      providerThreadId: started.providerThreadId,
      threadId,
    });
    return instructions;
  }

  private providerIdOf(row: ThreadRow | null): string {
    return row?.providerId ?? this.deps.defaultProviderId();
  }

  private harnessOf(threadId: string): HarnessDefinition | undefined {
    const providerId = this.providerIdOf(getThread(this.deps.db, threadId));
    return isHarnessId(providerId) ? HARNESSES[providerId] : undefined;
  }

  onInteractionResolved(interaction: PendingInteraction): void {
    this.waiters.resolve(interaction);
  }

  private onRuntimeEvent(event: ProviderEvent): void {
    const { threadId } = event;
    if (threadId.length === 0) {
      this.debug(`dropped unstamped provider event ${event.type}`);
      return;
    }
    const state = this.turnsByThreadId.get(threadId);
    this.noteTurnActivity(threadId);

    if (event.type === "turn/started") {
      this.onTurnStarted(event, state);
      return;
    }

    let hostTurnId: string | null = null;
    if (event.scope.kind === "turn") {
      if (state?.phase.kind !== "started" || state.phase.providerTurnId !== event.scope.turnId) {
        this.debug(
          `dropped ${event.type} for thread ${threadId}: provider turn ${event.scope.turnId} is not the bound one`,
        );
        return;
      }
      hostTurnId = state.ourTurnId;
    }

    if (
      state !== undefined &&
      (event.type === "item/started" || event.type === "item/completed") &&
      event.item.type === "fileChange"
    ) {
      state.writes.recordPaths(this.vaultPathsOf(event.item.changes));
    }

    const mapped = mapProviderEvent(event, hostTurnId);
    if (mapped.kind === "dropped") {
      this.debug(`dropped provider event for thread ${threadId}: ${mapped.reason}`);
      return;
    }
    if (event.type === "turn/completed") {
      // settle before ingest: the ingest transaction drains the queue and can synchronously
      // dispatch the next turn through startTurn, which must find this one released.
      this.settleTurn(threadId);
      this.sink.ingestProviderEvents(threadId, [mapped.event]);
      return;
    }
    this.events.push(threadId, mapped.event);
  }

  private onTurnStarted(
    event: Extract<ProviderEvent, { type: "turn/started" }>,
    state: ActiveTurn | undefined,
  ): void {
    const { threadId } = event;
    if (state?.phase.kind !== "dispatched") {
      this.debug(`dropped ${event.type} for thread ${threadId}: no dispatched turn awaits it`);
      return;
    }
    state.phase = {
      kind: "started",
      providerTurnId: event.scope.kind === "turn" ? event.scope.turnId : null,
    };
    const mapped = mapProviderEvent(event, state.ourTurnId);
    if (mapped.kind === "mapped") {
      this.events.push(threadId, mapped.event);
    }
  }

  private vaultPathsOf(changes: FileChangeProviderItem["changes"]): string[] {
    const reportedPaths = changes.flatMap((change) => [
      change.path,
      ...(change.movePath === undefined ? [] : [change.movePath]),
    ]);
    const vaultPaths: string[] = [];
    for (const reported of reportedPaths) {
      const rel = this.resolveVaultPath(reported);
      if (rel === null) {
        this.debug(`ignored a reported write outside the vault: ${reported}`);
        continue;
      }
      vaultPaths.push(rel);
    }
    return vaultPaths;
  }

  private async onInteractiveRequest(
    create: PendingInteractionCreate,
  ): Promise<PendingInteractionResolution> {
    const state = this.turnsByThreadId.get(create.threadId);
    const hostTurnId =
      state?.phase.kind === "started" && state.phase.providerTurnId === create.turnId
        ? state.ourTurnId
        : null;
    return await this.waiters.park(create, hostTurnId);
  }

  private settleTurn(threadId: string): void {
    // buffered deltas must be in the log before anything reads the turn as settled.
    this.events.flush(threadId);
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined) {
      return;
    }
    this.turnsByThreadId.delete(threadId);
    this.waiters.cancel(threadId);
    interruptOpenPendingInteractions(this.deps.db, this.deps.notifier, threadId);
    void this.finishWrites(threadId, state.writes);
  }

  private async finishWrites(threadId: string, writes: AgentTurnWrites): Promise<void> {
    try {
      await writes.finish();
    } catch (error) {
      this.debug(`settling the write set for thread ${threadId} failed: ${messageOf(error)}`);
    }
  }

  private failTurn(threadId: string, cause: unknown): void {
    const detail = describeProviderError(cause, this.harnessOf(threadId));
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined) {
      this.debug(`dispatch failure for thread ${threadId} after its turn settled: ${detail}`);
      return;
    }
    const scope = turnScope(state.ourTurnId);
    const events: ThreadEvent[] = [];
    if (state.phase.kind === "dispatched") {
      events.push({ scope, threadId, type: "turn/started" });
    }
    events.push(
      {
        detail,
        message: "The agent provider failed",
        scope: threadScope(),
        threadId,
        type: "provider/error",
      },
      { scope, status: "failed", threadId, type: "turn/completed" },
    );
    this.settleTurn(threadId);
    this.sink.ingestProviderEvents(threadId, events);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.events.flushAll();
    if (this.reapTimer !== null) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.waiters.cancel();
    if (this.runtime !== null) {
      await this.runtime.shutdown();
      this.runtime = null;
    }
  }
}

export const createAcpRuntimeManager = (deps: AcpRuntimeManagerDeps): AcpRuntimeManager => {
  let driver: AcpTurnDriver | null = null;
  return {
    createTurnDriver: (sink) => {
      // a second driver over the same manager would leave the first running unreachably and undisposed.
      if (driver !== null) {
        throw new Error("createTurnDriver was already called on this runtime manager");
      }
      driver = new AcpTurnDriver(sink, deps);
      return driver;
    },
    async dispose() {
      await driver?.dispose();
    },
  };
};
