// ONE agent runtime over the vault dir; the ACP adapter processes
// (claude-code-acp, codex-acp) are its children, lazily started on the first
// turn and reaped after idle. This is
// the CreateTurnDriver implementation bridging runtime→ThreadService:
//
// - TURN IDENTITY: the service mints the host turn id and hands it to
//   startTurn; the provider mints its own turn ids in its events. The manager owns
//   the binding — the first turn/started for a dispatched turn binds the
//   provider's turn id to the host's, every turn-scoped event is rewritten
//   through that binding, and a turn-scoped event naming any OTHER provider
//   turn (a resume replay) is dropped with a debug line. Provider event
//   kinds the persisted grammar does not carry are dropped the same way —
//   logged, never a crash (see event-mapping.ts).
// - FAILURE: any async dispatch failure settles the turn through the SAME
//   ingest grammar (turn/started if none was bound, provider/error,
//   turn/completed failed), so the thread lands in `error` instead of
//   wedging in `starting`.
// - INTERACTIONS: the driver binds a provider request to the host turn id
//   and hands it to interaction-waiters.ts, which owns the row, the parked
//   promise and its clock; the answer route reaches it through
//   onInteractionResolved, and a settle cancels that thread's waiters and
//   interrupts its open rows.
// - WRITES: a turn takes the vault's commit hold at dispatch and the settle
//   path commits the recorded write set as the agent — see agent-commits.ts
//   for the race design.
// - THE WATCHDOG: a turn that goes quiet for too long is FAILED through the
//   same grammar, because the hold it carries is not local to the thread —
//   while it is open the vault's auto-commit defers and no sync pass may
//   start. A provider that hangs (rather than crashing, which onProcessExit
//   already covers) would hold both until the process restarts, so a turn is
//   bounded rather than trusted.

import {
  createAcpAgentRuntime,
  type AcpAgentRuntimeOptions,
  type AcpMcpServerConfig,
} from "@repo/agent-runtime/acp/acp-runtime";
import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import { interruptOpenPendingInteractions } from "@repo/db/pending-interactions";
import { getThread, setThreadProviderSession } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import type {
  CreateTurnDriver,
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
} from "../threads/turn-driver";
import type { GitEngine } from "../vault/git-engine";
import {
  beginAgentTurnWrites,
  createVaultPathResolver,
  type AgentTurnWrites,
  type VaultPathResolver,
} from "./agent-commits";
import { toInstructions } from "./agent-instructions";
import { toShellEnv, type AgentSessionFacts } from "./agent-shell-env";
import { ProviderEventCoalescer } from "./event-coalescer";
import { mapProviderEvent } from "./event-mapping";
import { createInteractionWaiters, type InteractionWaiters } from "./interaction-waiters";
import { turnPromptInput } from "./view-context-prompt";

/** Statically-always-dropped kinds that arrive on every token tick: the
 * translation emits them as the pair of thread/tokenUsage/updated (persisted)
 * and thread/contextWindowUsage/updated (not) — dropping the second half is
 * the steady state, not worth a debug line each time. */
const SILENTLY_DROPPED_EVENT_TYPES: ReadonlySet<ProviderEvent["type"]> = new Set([
  "thread/contextWindowUsage/updated",
]);

const DEFAULT_REAP_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_REAP_MS = 10 * 60_000;

/**
 * How long a dispatched turn may produce NOTHING before it is failed. Idle
 * time, not wall time: a turn that streams for an hour is working, and a turn
 * parked on an approval is waiting on the user (that wait has its own clock —
 * the waiters' INTERACTION_TIMEOUT_MS — and the sweep skips a parked thread
 * for its duration). What is left is a provider that accepted a turn and then
 * went silent, which no other path settles — the process is alive, so
 * `onProcessExit` never fires.
 */
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 10 * 60_000;

/** The idle check is a SWEEP over per-turn timestamps, not a timer per
 *  provider event: a streaming turn produces thousands of frames, and
 *  re-arming a timeout for each buys nothing over a bounded-lag check. */
const WATCHDOG_SWEEP_INTERVAL_MS = 1_000;

export interface AcpRuntimeManagerDeps {
  db: DbConnection;
  notifier: DbNotifier;
  vaultDir: string;
  git: GitEngine;
  /** null means the provider's default model. */
  model: string | null;
  /**
   * What a session is told about this instance (agent-shell-env.ts) — the
   * seam that names the instance so the harness can drive the product through
   * the CLI. A getter read at EVERY session open, never a value: the Connected
   * Folders are Settings-mutable, and the runtime spawns each session's
   * adapter from the env this projects, so a value read once would tell every
   * later session the set the first one saw.
   */
  sessionFacts: () => AgentSessionFacts;
  /** The host environment whose PATH the agent's shell extends. */
  hostEnv: NodeJS.ProcessEnv;
  /** The harness a NEW thread runs on; a resumed thread keeps its own. */
  defaultProviderId: HarnessId;
  /** Tests: replace the adapter child spawn (the fake ACP agent). */
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"];
  /** The enabled connector rows every session gets. */
  mcpServers: () => AcpMcpServerConfig[] | Promise<AcpMcpServerConfig[]>;
  /** Tests: replace runtime construction with a fake (the watchdog and
   *  shell-env suites). */
  createRuntime?: typeof createAcpAgentRuntime;
  /** null disables the reap interval (tests drive reaping directly). */
  reapIntervalMs?: number | null;
  /** The idle budget a dispatched turn gets; null disables the watchdog. */
  turnIdleTimeoutMs?: number | null;
  onDebug?: (message: string) => void;
}

export interface AcpRuntimeManager {
  createTurnDriver: CreateTurnDriver;
  dispose(): Promise<void>;
}

interface ActiveTurn {
  ourTurnId: string;
  providerTurnId: string | null;
  /** True once the host's turn/started was ingested. */
  started: boolean;
  /**
   * Which process GENERATION accepted this turn (the per-thread exit counter
   * at turn/started); null until accepted. A process exit fails only the
   * turns its own generation accepted — a turn dispatched INTO a harness's
   * account-restart window (the runtime replaces the app-server process
   * before sending turn/start) must survive onto the replacement.
   */
  acceptedGeneration: number | null;
  settled: boolean;
  writes: AgentTurnWrites;
  /** When the provider last said anything for this turn — what the idle
   *  sweep measures silence against. */
  lastEventAt: number;
}

class AcpTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: AcpRuntimeManagerDeps;
  private readonly resolveVaultPath: VaultPathResolver;
  private runtime: AgentRuntime | null = null;
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  /** One ingest txn + one ws frame per streaming burst, not per delta. */
  private readonly events = new ProviderEventCoalescer((threadId, batch) =>
    this.sink.ingestProviderEvents(threadId, batch),
  );
  private readonly turnsByThreadId = new Map<string, ActiveTurn>();
  /** Bumped on every provider-process exit that hosted the thread. */
  private readonly exitGenerationByThreadId = new Map<string, number>();
  private readonly waiters: InteractionWaiters;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(sink: ProviderEventSink, deps: AcpRuntimeManagerDeps) {
    this.sink = sink;
    this.deps = deps;
    this.resolveVaultPath = createVaultPathResolver(deps.vaultDir);
    this.waiters = createInteractionWaiters({
      db: deps.db,
      notifier: deps.notifier,
      debug: (message) => this.debug(message),
      onWaitSettled: (threadId) => this.noteTurnActivity(threadId),
    });
    const budgetMs = deps.turnIdleTimeoutMs ?? DEFAULT_TURN_IDLE_TIMEOUT_MS;
    if (deps.turnIdleTimeoutMs !== null) {
      this.watchdogTimer = setInterval(
        () => this.sweepIdleTurns(budgetMs),
        // A budget below the sweep cadence still fails within ~2x its own
        // bound rather than waiting out the coarser tick.
        Math.min(budgetMs, WATCHDOG_SWEEP_INTERVAL_MS),
      );
      this.watchdogTimer.unref();
    }
  }

  private debug(message: string): void {
    this.deps.onDebug?.(message);
  }

  private ensureRuntime(): AgentRuntime {
    if (this.runtime !== null) {
      return this.runtime;
    }
    const createRuntime = this.deps.createRuntime ?? createAcpAgentRuntime;
    const runtimeOptions: AcpAgentRuntimeOptions = {
      workspacePath: this.deps.vaultDir,
      onEvent: (event) => this.onRuntimeEvent(event),
      onInteractiveRequest: (request) => this.onInteractiveRequest(request),
      onStderr: (line) => this.debug(`agent: ${line}`),
      onProcessExit: (info) => {
        for (const thread of info.threads) {
          const generationAtExit = this.exitGenerationByThreadId.get(thread.threadId) ?? 0;
          this.exitGenerationByThreadId.set(thread.threadId, generationAtExit + 1);
          const state = this.turnsByThreadId.get(thread.threadId);
          if (state === undefined || state.settled) {
            continue;
          }
          // Fail only what the DYING process was actually running: a turn it
          // accepted (matching generation), or one it acknowledged but never
          // started. A not-yet-sent turn (dispatched during an expected
          // account restart) continues on the replacement process; a crash
          // before acceptance is settled by the dispatch promise rejection.
          const dyingProcessOwnedTurn =
            (state.started && state.acceptedGeneration === generationAtExit) ||
            (!state.started && thread.pendingTurnStart);
          if (!dyingProcessOwnedTurn) {
            this.debug(
              `provider process exit (expected=${String(info.expected)}) skipped thread ${thread.threadId}: its turn is not bound to the dying process`,
            );
            continue;
          }
          this.failTurn(
            thread.threadId,
            new Error(
              `The ${info.providerId} process exited mid-turn${info.stderr !== null ? `: ${info.stderr}` : ""}`,
            ),
          );
        }
      },
    };
    runtimeOptions.shellEnv = () => ({
      ...toShellEnv(this.deps.sessionFacts(), this.deps.hostEnv),
    });
    if (this.deps.model !== null) runtimeOptions.model = this.deps.model;
    runtimeOptions.mcpServers = this.deps.mcpServers;
    if (this.deps.spawnAdapter !== undefined) runtimeOptions.spawnAdapter = this.deps.spawnAdapter;
    const runtime = createRuntime(runtimeOptions);
    this.runtime = runtime;
    const reapIntervalMs = this.deps.reapIntervalMs;
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
            this.debug(
              `idle session reaping failed: ${error instanceof Error ? error.message : String(error)}`,
            );
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
    const existing = this.turnsByThreadId.get(args.threadId);
    if (existing !== undefined && !existing.settled) {
      throw new Error(`Thread ${args.threadId} already has a running turn`);
    }
    this.turnsByThreadId.set(args.threadId, {
      ourTurnId: args.turnId,
      providerTurnId: null,
      started: false,
      acceptedGeneration: null,
      settled: false,
      writes: beginAgentTurnWrites({
        git: this.deps.git,
        threadId: args.threadId,
        turnId: args.turnId,
      }),
      lastEventAt: Date.now(),
    });
    void this.dispatchTurn(args).catch((cause: unknown) => {
      this.failTurn(args.threadId, cause);
    });
  }

  /**
   * (Re)start a thread's silence clock — at dispatch, on every provider
   * event, and when a parked approval settles, so the budget measures
   * SILENCE rather than duration.
   */
  private noteTurnActivity(threadId: string): void {
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined || state.settled) {
      return;
    }
    state.lastEventAt = Date.now();
  }

  /**
   * Fail every turn whose silence has outgrown the budget. A parked approval
   * is exempt: that wait belongs to the user and to the waiters' own clock,
   * and the deny that clock produces restarts this one (`onWaitSettled`).
   */
  private sweepIdleTurns(budgetMs: number): void {
    if (this.disposed) {
      return;
    }
    const now = Date.now();
    for (const [threadId, state] of this.turnsByThreadId) {
      if (state.settled || this.waiters.hasParked(threadId)) {
        continue;
      }
      if (now - state.lastEventAt <= budgetMs) {
        continue;
      }
      this.failTurn(
        threadId,
        new Error(
          `The agent produced nothing for ${budgetMs}ms; the turn was abandoned so the vault can commit and sync again`,
        ),
      );
    }
  }

  private async dispatchTurn(args: TurnDriverStartArgs): Promise<void> {
    // The hold (taken in startTurn) blocks NEW sync passes; this barrier
    // waits out one already mid-flight, so the provider never writes into a
    // rebase's checkout window.
    await this.turnsByThreadId.get(args.threadId)?.writes.ready;
    const runtime = this.ensureRuntime();
    // The session's standing instructions ride the FIRST turn's prompt: ACP's
    // session/new carries no instructions field, so `input` is the only
    // channel that reaches the model at all (see view-context-prompt.ts).
    const instructions = runtime.hasThread(args.threadId)
      ? undefined
      : await this.openThreadSession(runtime, args.threadId);
    await runtime.runTurn({
      threadId: args.threadId,
      input: turnPromptInput(args.text, args.viewContext, instructions),
    });
  }

  /** Opens the provider session and returns the instructions its first turn
   *  must carry, or undefined when this deployment composes none. */
  private async openThreadSession(
    runtime: AgentRuntime,
    threadId: string,
  ): Promise<string | undefined> {
    const instructions = toInstructions(this.deps.sessionFacts(), this.deps.vaultDir);
    const row = getThread(this.deps.db, threadId);
    const persisted = row?.providerThreadId ?? null;
    // A thread that ever ran keeps its harness; a new one adopts the default.
    const providerId = row?.providerId ?? this.deps.defaultProviderId;
    if (persisted !== null) {
      try {
        const resumed = await runtime.resumeThread({
          threadId,
          providerThreadId: persisted,
          providerId,
        });
        setThreadProviderSession(this.deps.db, {
          threadId,
          providerId,
          providerThreadId: resumed.providerThreadId,
        });
        return instructions;
      } catch (error) {
        // The provider's rollout can be gone (cleaned ~/.codex, another
        // machine). Prior context is lost either way; a fresh session keeps
        // the thread usable rather than permanently wedged on resume.
        this.debug(
          `resume of thread ${threadId} from provider session ${persisted} failed; starting fresh: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const started = await runtime.startThread({ threadId, providerId });
    setThreadProviderSession(this.deps.db, {
      threadId,
      providerId,
      providerThreadId: started.providerThreadId,
    });
    return instructions;
  }

  onInteractionResolved(interaction: PendingInteraction): void {
    this.waiters.resolve(interaction);
  }

  private onRuntimeEvent(event: ProviderEvent): void {
    const threadId = event.threadId;
    if (threadId.length === 0) {
      this.debug(`dropped unstamped provider event ${event.type}`);
      return;
    }
    const state = this.turnsByThreadId.get(threadId);
    // ANY frame for this thread is the provider proving it is alive; the
    // budget measures silence, so every one of them resets the clock.
    this.noteTurnActivity(threadId);

    if (event.type === "turn/started") {
      if (state === undefined || state.settled || state.started) {
        this.debug(`dropped ${event.type} for thread ${threadId}: no dispatched turn awaits it`);
        return;
      }
      state.providerTurnId = event.scope.kind === "turn" ? event.scope.turnId : null;
      state.started = true;
      state.acceptedGeneration = this.exitGenerationByThreadId.get(threadId) ?? 0;
      const mapped = mapProviderEvent(event, state.ourTurnId);
      if (mapped.kind === "mapped") {
        this.events.push(threadId, mapped.event);
      }
      return;
    }

    let hostTurnId: string | null = null;
    if (event.scope.kind === "turn") {
      if (
        state === undefined ||
        state.settled ||
        !state.started ||
        state.providerTurnId !== event.scope.turnId
      ) {
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
      const reportedPaths = event.item.changes.flatMap((change) => [
        change.path,
        ...(change.movePath !== undefined ? [change.movePath] : []),
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
      state.writes.recordPaths(vaultPaths);
    }

    const mapped = mapProviderEvent(event, hostTurnId);
    if (mapped.kind === "dropped") {
      if (!SILENTLY_DROPPED_EVENT_TYPES.has(event.type)) {
        this.debug(`dropped provider event for thread ${threadId}: ${mapped.reason}`);
      }
      return;
    }
    if (event.type === "turn/completed") {
      // Settle BEFORE ingest (and settle flushes the buffered deltas first):
      // the ingest transaction drains the queue and can synchronously
      // dispatch the next turn through startTurn, which must find this turn
      // fully released.
      this.settleTurn(threadId);
      this.sink.ingestProviderEvents(threadId, [mapped.event]);
      return;
    }
    this.events.push(threadId, mapped.event);
  }

  private onInteractiveRequest(
    create: PendingInteractionCreate,
  ): Promise<PendingInteractionResolution> {
    const state = this.turnsByThreadId.get(create.threadId);
    const hostTurnId =
      state !== undefined && !state.settled && state.providerTurnId === create.turnId
        ? state.ourTurnId
        : null;
    return this.waiters.park(create, hostTurnId);
  }

  private settleTurn(threadId: string): void {
    // Buffered deltas must be in the log before anything reads the turn as
    // settled — a queue drain's next turn included.
    this.events.flush(threadId);
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined || state.settled) {
      return;
    }
    state.settled = true;
    this.turnsByThreadId.delete(threadId);
    this.waiters.cancel(threadId);
    interruptOpenPendingInteractions(this.deps.db, this.deps.notifier, threadId);
    void state.writes.finish().catch((cause: unknown) => {
      this.debug(
        `settling the write set for thread ${threadId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
  }

  /** Settle a turn the provider never (or no longer) reports on, through the
   *  same grammar a provider report uses. */
  private failTurn(threadId: string, cause: unknown): void {
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined || state.settled) {
      this.debug(
        `dispatch failure for thread ${threadId} after its turn settled: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return;
    }
    const scope = turnScope(state.ourTurnId);
    const events: ThreadEvent[] = [];
    if (!state.started) {
      state.started = true;
      events.push({ type: "turn/started", threadId, scope });
    }
    events.push(
      {
        type: "provider/error",
        threadId,
        message: "The agent provider failed",
        detail: cause instanceof Error ? cause.message : String(cause),
        scope: threadScope(),
      },
      { type: "turn/completed", threadId, status: "failed", scope },
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

export function createAcpRuntimeManager(deps: AcpRuntimeManagerDeps): AcpRuntimeManager {
  let driver: AcpTurnDriver | null = null;
  return {
    createTurnDriver: (sink) => {
      // Single-assignment: a second service over the same manager would leave
      // the first driver running unreachably and undisposed.
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
}
