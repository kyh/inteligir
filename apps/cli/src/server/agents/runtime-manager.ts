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
// - INTERACTIONS: the runtime's onInteractiveRequest is the producer for
//   pending_interactions — the row is created (idempotent on the provider's
//   request key), the ws invalidation rides the notifier, and the promise
//   parks until the answer route resolves the row (the service calls
//   onInteractionResolved) or the turn settles, which interrupts open rows
//   and answers the provider with a deny.
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
import {
  approvalPendingInteractionPayloadSchema,
  parseApprovalResolution,
  type PendingInteractionCreate,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  createPendingInteraction,
  interruptOpenPendingInteractions,
  interruptPendingInteraction,
  type CreatePendingInteractionInput,
} from "@repo/db/pending-interactions";
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
const INTERACTION_TIMEOUT_MS = 30 * 60_000;

/**
 * How long a dispatched turn may produce NOTHING before it is failed. Idle
 * time, not wall time: a turn that streams for an hour is working, and a turn
 * parked on an approval is waiting on the user (that wait has its own clock,
 * INTERACTION_TIMEOUT_MS, and this one is disarmed for its duration). What is
 * left is a provider that accepted a turn and then went silent, which no other
 * path settles — the process is alive, so `onProcessExit` never fires.
 */
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 10 * 60_000;

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
  /** The enabled connector rows every session gets (issue #591). */
  mcpServers: () => AcpMcpServerConfig[] | Promise<AcpMcpServerConfig[]>;
  /** Tests: observe/replace runtime construction (the shellEnv wiring test). */
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
  /** The idle watchdog, re-armed by every provider event and disarmed while
   *  an approval is parked. Null means unarmed, not "no budget". */
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface InteractionWaiter {
  threadId: string;
  payload: PendingInteractionPayload;
  resolve: (resolution: PendingInteractionResolution) => void;
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
  private readonly waitersByInteractionId = new Map<string, InteractionWaiter>();
  private disposed = false;

  constructor(sink: ProviderEventSink, deps: AcpRuntimeManagerDeps) {
    this.sink = sink;
    this.deps = deps;
    this.resolveVaultPath = createVaultPathResolver(deps.vaultDir);
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
      idleTimer: null,
    });
    this.armWatchdog(args.threadId);
    void this.dispatchTurn(args).catch((cause: unknown) => {
      this.failTurn(args.threadId, cause);
    });
  }

  /** True while an approval for this thread is parked on the user's answer. */
  private hasParkedApproval(threadId: string): boolean {
    for (const waiter of this.waitersByInteractionId.values()) {
      if (waiter.threadId === threadId) {
        return true;
      }
    }
    return false;
  }

  /**
   * (Re)start the idle budget for a thread's turn — called at dispatch and on
   * every provider event, so the budget measures SILENCE rather than duration.
   * A parked approval leaves it disarmed: that wait belongs to the user and to
   * INTERACTION_TIMEOUT_MS, and the deny that clock produces re-arms this one.
   */
  private armWatchdog(threadId: string): void {
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined || state.settled || this.disposed) {
      return;
    }
    this.disarmWatchdog(state);
    const budgetMs = this.deps.turnIdleTimeoutMs ?? DEFAULT_TURN_IDLE_TIMEOUT_MS;
    if (this.deps.turnIdleTimeoutMs === null || this.hasParkedApproval(threadId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.failTurn(
        threadId,
        new Error(
          `The agent produced nothing for ${budgetMs}ms; the turn was abandoned so the vault can commit and sync again`,
        ),
      );
    }, budgetMs);
    timer.unref();
    state.idleTimer = timer;
  }

  private disarmWatchdog(state: ActiveTurn): void {
    if (state.idleTimer !== null) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
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
    const waiter = this.waitersByInteractionId.get(interaction.id);
    if (waiter === undefined) {
      return;
    }
    this.waitersByInteractionId.delete(interaction.id);
    const parsed =
      interaction.resolution === null
        ? null
        : parseApprovalResolution(interaction.resolution, waiter.payload);
    if (parsed === null || !parsed.ok) {
      this.debug(
        `interaction ${interaction.id} resolved with an unparseable resolution; denying the provider`,
      );
      waiter.resolve({ decision: "deny" });
      return;
    }
    waiter.resolve(parsed.resolution);
  }

  private onRuntimeEvent(event: ProviderEvent): void {
    const threadId = event.threadId;
    if (threadId.length === 0) {
      this.debug(`dropped unstamped provider event ${event.type}`);
      return;
    }
    const state = this.turnsByThreadId.get(threadId);
    // ANY frame for this thread is the provider proving it is alive; the
    // budget below measures silence, so every one of them resets it.
    this.armWatchdog(threadId);

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

  private async onInteractiveRequest(
    create: PendingInteractionCreate,
  ): Promise<PendingInteractionResolution> {
    const payload = approvalPendingInteractionPayloadSchema.parse(create.payload);
    const state = this.turnsByThreadId.get(create.threadId);
    const hostTurnId =
      state !== undefined && !state.settled && state.providerTurnId === create.turnId
        ? state.ourTurnId
        : null;
    const pending: CreatePendingInteractionInput = {
      threadId: create.threadId,
      requestKey: create.providerRequestId,
      payload: JSON.stringify(payload),
    };
    if (hostTurnId !== null) pending.turnId = hostTurnId;
    const row = createPendingInteraction(this.deps.db, this.deps.notifier, pending);
    if (row.status === "resolved" && row.resolution !== null) {
      const parsed = parseApprovalResolution(row.resolution, payload);
      return parsed.ok ? parsed.resolution : { decision: "deny" };
    }
    if (row.status === "interrupted") {
      return { decision: "deny" };
    }
    return new Promise<PendingInteractionResolution>((resolve) => {
      let settled = false;
      const settle = (resolution: PendingInteractionResolution): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(resolution);
      };
      const timer = setTimeout(() => {
        if (this.waitersByInteractionId.delete(row.id)) {
          interruptPendingInteraction(this.deps.db, this.deps.notifier, {
            id: row.id,
            threadId: create.threadId,
          });
          settle({ decision: "deny" });
          this.armWatchdog(create.threadId);
        }
      }, INTERACTION_TIMEOUT_MS);
      timer.unref();
      this.waitersByInteractionId.set(row.id, {
        threadId: create.threadId,
        payload,
        resolve: (resolution) => {
          clearTimeout(timer);
          settle(resolution);
          // The provider is free to work again, so its silence starts counting
          // again from here.
          this.armWatchdog(create.threadId);
        },
      });
      // Parked on the user: disarm, or the turn budget would quietly become
      // the approval budget.
      this.armWatchdog(create.threadId);
    });
  }

  /** Deny every parked approval — for one thread (a settle; its rows are
   *  interrupted by the caller) or for all of them (dispose). */
  private cancelWaiters(threadId?: string): void {
    // Snapshot first: the loop deletes entries mid-iteration.
    const waiters = Array.from(this.waitersByInteractionId);
    for (const [id, waiter] of waiters) {
      if (threadId !== undefined && waiter.threadId !== threadId) {
        continue;
      }
      this.waitersByInteractionId.delete(id);
      waiter.resolve({ decision: "deny" });
    }
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
    this.disarmWatchdog(state);
    this.turnsByThreadId.delete(threadId);
    this.cancelWaiters(threadId);
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
    this.cancelWaiters();
    // After the waiters, not before: resolving one re-arms its thread's
    // budget, and `disposed` above is what stops that from outliving us.
    for (const state of this.turnsByThreadId.values()) {
      this.disarmWatchdog(state);
    }
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
