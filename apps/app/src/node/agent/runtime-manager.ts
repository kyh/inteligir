// ONE agent runtime over the vault dir; codex app-server processes are its
// children, lazily started on the first turn and reaped after idle. This is
// the CreateTurnDriver implementation bridging runtime→ThreadService:
//
// - TURN IDENTITY: the service mints the host turn id and hands it to
//   startTurn; codex mints its own turn ids in its events. The manager owns
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
// - COMMITS: a turn takes the vault's commit hold at dispatch and the settle
//   path commits as the agent — see agent-commits.ts for the race design.

import {
  createAgentRuntimeWithAdapters,
  type ProviderAdapterFactory,
} from "@repo/agent-runtime/runtime";
import type {
  AgentRuntime,
  AgentRuntimeExecutionOptions,
  AgentRuntimeShellEnvironment,
} from "@repo/agent-runtime/types";
import type { ThreadEvent as RuntimeThreadEvent } from "@repo/agent-runtime/domain/provider-event";
import {
  approvalPendingInteractionPayloadSchema,
  parseApprovalResolution,
  type PendingInteractionCreate,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
} from "@repo/agent-runtime/domain/pending-interactions";
import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/db/notifier";
import {
  createPendingInteraction,
  interruptOpenPendingInteractions,
  interruptPendingInteraction,
} from "@repo/db/pending-interactions";
import { getThread, setThreadProviderSession } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type { PendingInteraction } from "@repo/server-contract/threads";
import type {
  CreateTurnDriver,
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
  TurnDriverSteerArgs,
} from "../threads/turn-driver";
import type { GitEngine } from "../vault/git";
import {
  beginAgentTurnCommit,
  createVaultPathResolver,
  type AgentTurnCommit,
  type VaultPathResolver,
} from "./agent-commits";
import { loadAgentInstructions } from "./agent-instructions";
import { ProviderEventCoalescer } from "./event-coalescer";
import { mapProviderEvent } from "./event-mapping";

/** Statically-always-dropped kinds that arrive on every token tick: the
 * translation emits them as the pair of thread/tokenUsage/updated (persisted)
 * and thread/contextWindowUsage/updated (not) — dropping the second half is
 * the steady state, not worth a debug line each time. */
const SILENTLY_DROPPED_EVENT_TYPES: ReadonlySet<RuntimeThreadEvent["type"]> = new Set([
  "thread/contextWindowUsage/updated",
]);

const CODEX_PROVIDER_ID = "codex";
const DEFAULT_REAP_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_REAP_MS = 10 * 60_000;
const INTERACTION_TIMEOUT_MS = 30 * 60_000;

export interface CodexRuntimeManagerDeps {
  db: DbConnection;
  notifier: DbNotifier;
  vaultDir: string;
  git: GitEngine;
  /** null means the provider's default model. */
  model: string | null;
  /**
   * Env injected into the agent's SHELL (the runtime adds INTELIGIR_THREAD_ID
   * per thread) — the seam that hands codex INTELIGIR_SERVER_URL so it can
   * drive the product through the CLI. A getter, because the value it carries
   * (the bound port) exists only after listen, while this manager is
   * constructed before; it is read at runtime construction, on the first turn.
   */
  shellEnv?: () => AgentRuntimeShellEnvironment;
  /**
   * Where the `inteligir` binary lives, or null when this deployment ships
   * none. The instructions only PROMISE the CLI when the shell env can
   * really reach it — see agent-shell-env.ts.
   */
  cliBinDir?: string | null;
  /** Tests: point the runtime at a fake app-server. */
  adapterFactory?: ProviderAdapterFactory;
  /** Tests: observe/replace runtime construction (the shellEnv wiring test). */
  createRuntime?: typeof createAgentRuntimeWithAdapters;
  /** null disables the reap interval (tests drive reaping directly). */
  reapIntervalMs?: number | null;
  onDebug?: (message: string) => void;
}

export interface CodexRuntimeManager {
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
   * turns its own generation accepted — a turn dispatched INTO the codex
   * account-restart window (the runtime replaces the app-server process
   * before sending turn/start) must survive onto the replacement.
   */
  acceptedGeneration: number | null;
  settled: boolean;
  commit: AgentTurnCommit;
}

interface InteractionWaiter {
  threadId: string;
  payload: PendingInteractionPayload;
  resolve: (resolution: PendingInteractionResolution) => void;
}

function executionOptionsFor(model: string | null): AgentRuntimeExecutionOptions {
  return {
    ...(model !== null ? { model } : {}),
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "ask",
  };
}

class CodexTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: CodexRuntimeManagerDeps;
  private readonly options: AgentRuntimeExecutionOptions;
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

  constructor(sink: ProviderEventSink, deps: CodexRuntimeManagerDeps) {
    this.sink = sink;
    this.deps = deps;
    this.options = executionOptionsFor(deps.model);
    this.resolveVaultPath = createVaultPathResolver(deps.vaultDir);
  }

  private debug(message: string): void {
    this.deps.onDebug?.(message);
  }

  private ensureRuntime(): AgentRuntime {
    if (this.runtime !== null) {
      return this.runtime;
    }
    const createRuntime = this.deps.createRuntime ?? createAgentRuntimeWithAdapters;
    const runtime = createRuntime({
      workspacePath: this.deps.vaultDir,
      ...(this.deps.shellEnv !== undefined ? { shellEnv: this.deps.shellEnv() } : {}),
      ...(this.deps.adapterFactory !== undefined
        ? { adapterFactory: this.deps.adapterFactory }
        : {}),
      onEvent: (event) => this.onRuntimeEvent(event),
      onInteractiveRequest: (request) => this.onInteractiveRequest(request),
      onStderr: (line) => this.debug(`codex: ${line}`),
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
              `The codex process exited mid-turn${info.stderr !== null ? `: ${info.stderr}` : ""}`,
            ),
          );
        }
      },
    });
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
                `reaped idle codex session for thread ${reaped.threadId} after ${reaped.idleForMs}ms`,
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
      commit: beginAgentTurnCommit(this.deps.git, args.threadId),
    });
    void this.dispatchTurn(args).catch((error: unknown) => {
      this.failTurn(args.threadId, error);
    });
  }

  private async dispatchTurn(args: TurnDriverStartArgs): Promise<void> {
    // The hold (taken in startTurn) blocks NEW sync passes; this barrier
    // waits out one already mid-flight, so the provider never writes into a
    // rebase's checkout window.
    await this.turnsByThreadId.get(args.threadId)?.commit.ready;
    const runtime = this.ensureRuntime();
    if (!runtime.hasThread(args.threadId)) {
      await this.openThreadSession(runtime, args.threadId);
    }
    await runtime.runTurn({
      threadId: args.threadId,
      input: [{ type: "text", text: args.text }],
      options: this.options,
    });
  }

  private async openThreadSession(runtime: AgentRuntime, threadId: string): Promise<void> {
    const instructions = loadAgentInstructions(this.deps.vaultDir, this.deps.cliBinDir ?? null);
    const persisted = getThread(this.deps.db, threadId)?.providerThreadId ?? null;
    if (persisted !== null) {
      try {
        const resumed = await runtime.resumeThread({
          threadId,
          providerThreadId: persisted,
          providerId: CODEX_PROVIDER_ID,
          options: this.options,
          ...(instructions === undefined ? {} : { instructions }),
        });
        setThreadProviderSession(this.deps.db, {
          threadId,
          providerId: CODEX_PROVIDER_ID,
          providerThreadId: resumed.providerThreadId,
        });
        return;
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
    const started = await runtime.startThread({
      threadId,
      providerId: CODEX_PROVIDER_ID,
      options: this.options,
      ...(instructions === undefined ? {} : { instructions }),
    });
    setThreadProviderSession(this.deps.db, {
      threadId,
      providerId: CODEX_PROVIDER_ID,
      providerThreadId: started.providerThreadId,
    });
  }

  steerTurn(args: TurnDriverSteerArgs): boolean {
    const state = this.turnsByThreadId.get(args.threadId);
    const runtime = this.runtime;
    if (
      runtime === null ||
      state === undefined ||
      state.settled ||
      !state.started ||
      state.ourTurnId !== args.turnId ||
      state.providerTurnId === null
    ) {
      return false;
    }
    const expectedTurnId = state.providerTurnId;
    void (async () => {
      try {
        const result = await runtime.steerTurn({
          threadId: args.threadId,
          expectedTurnId,
          input: [{ type: "text", text: args.text }],
          options: this.options,
        });
        if (result.status === "stale") {
          this.debug(`steer for thread ${args.threadId} arrived after the turn settled`);
        }
      } catch (error) {
        this.debug(
          `steer for thread ${args.threadId} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
    return true;
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

  private onRuntimeEvent(event: RuntimeThreadEvent): void {
    const threadId = event.threadId;
    if (threadId.length === 0) {
      this.debug(`dropped unstamped provider event ${event.type}`);
      return;
    }
    const state = this.turnsByThreadId.get(threadId);

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
      state.commit.recordPaths(vaultPaths);
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
    const row = createPendingInteraction(this.deps.db, this.deps.notifier, {
      threadId: create.threadId,
      ...(hostTurnId !== null ? { turnId: hostTurnId } : {}),
      requestKey: create.providerRequestId,
      payload: JSON.stringify(payload),
    });
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
        }
      }, INTERACTION_TIMEOUT_MS);
      timer.unref();
      this.waitersByInteractionId.set(row.id, {
        threadId: create.threadId,
        payload,
        resolve: (resolution) => {
          clearTimeout(timer);
          settle(resolution);
        },
      });
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
    this.turnsByThreadId.delete(threadId);
    this.cancelWaiters(threadId);
    interruptOpenPendingInteractions(this.deps.db, this.deps.notifier, threadId);
    void state.commit.finish().catch((error: unknown) => {
      this.debug(
        `agent commit for thread ${threadId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /** Settle a turn the provider never (or no longer) reports on, through the
   *  same grammar a provider report uses. */
  private failTurn(threadId: string, error: unknown): void {
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined || state.settled) {
      this.debug(
        `dispatch failure for thread ${threadId} after its turn settled: ${
          error instanceof Error ? error.message : String(error)
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
        detail: error instanceof Error ? error.message : String(error),
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
    if (this.runtime !== null) {
      await this.runtime.shutdown();
      this.runtime = null;
    }
  }
}

export function createCodexRuntimeManager(deps: CodexRuntimeManagerDeps): CodexRuntimeManager {
  let driver: CodexTurnDriver | null = null;
  return {
    createTurnDriver: (sink) => {
      // Single-assignment: a second service over the same manager would leave
      // the first driver running unreachably and undisposed.
      if (driver !== null) {
        throw new Error("createTurnDriver was already called on this runtime manager");
      }
      driver = new CodexTurnDriver(sink, deps);
      return driver;
    },
    async dispose() {
      await driver?.dispose();
    },
  };
}
