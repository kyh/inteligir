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
import type { AgentRuntime, AgentRuntimeExecutionOptions } from "@repo/agent-runtime/types";
import type { ThreadEvent as RuntimeThreadEvent } from "@repo/agent-runtime/domain/provider-event";
import {
  approvalPendingInteractionPayloadSchema,
  approvalPendingInteractionResolutionSchema,
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
import { beginAgentTurnCommit } from "./agent-commits";
import { loadAgentInstructions } from "./agent-instructions";
import { mapProviderEvent } from "./event-mapping";

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
  /** Tests: point the runtime at a fake app-server. */
  adapterFactory?: ProviderAdapterFactory;
  /** null disables the reap interval (tests drive reaping directly). */
  reapIntervalMs?: number | null;
  idleReapMs?: number;
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
  settled: boolean;
  finishCommit: () => Promise<void>;
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

/**
 * The client answers with either a bare decision verb ("deny", "allow_once",
 * "allow_for_session") or the full resolution JSON. A permission-grant
 * approval whose allow carries no explicit grant falls back to granting
 * exactly what the payload requested.
 */
export function parseInteractionResolution(
  raw: string,
  payload: PendingInteractionPayload,
): PendingInteractionResolution | null {
  const trimmed = raw.trim();
  let parsed: PendingInteractionResolution;
  if (trimmed === "deny") {
    parsed = { decision: "deny" };
  } else if (trimmed === "allow_once" || trimmed === "allow_for_session") {
    parsed = { decision: trimmed, grantedPermissions: null };
  } else {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return null;
    }
    const result = approvalPendingInteractionResolutionSchema.safeParse(json);
    if (!result.success) {
      return null;
    }
    parsed = result.data;
  }
  if (
    parsed.decision !== "deny" &&
    parsed.grantedPermissions === null &&
    payload.subject.kind === "permission_grant"
  ) {
    return { decision: parsed.decision, grantedPermissions: payload.subject.permissions };
  }
  return parsed;
}

class CodexTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: CodexRuntimeManagerDeps;
  private readonly options: AgentRuntimeExecutionOptions;
  private runtime: AgentRuntime | null = null;
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  private readonly turnsByThreadId = new Map<string, ActiveTurn>();
  private readonly waitersByInteractionId = new Map<string, InteractionWaiter>();
  private disposed = false;

  constructor(sink: ProviderEventSink, deps: CodexRuntimeManagerDeps) {
    this.sink = sink;
    this.deps = deps;
    this.options = executionOptionsFor(deps.model);
  }

  private debug(message: string): void {
    this.deps.onDebug?.(message);
  }

  private ensureRuntime(): AgentRuntime {
    if (this.runtime !== null) {
      return this.runtime;
    }
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: this.deps.vaultDir,
      ...(this.deps.adapterFactory !== undefined
        ? { adapterFactory: this.deps.adapterFactory }
        : {}),
      onEvent: (event) => this.onRuntimeEvent(event),
      onInteractiveRequest: (request) => this.onInteractiveRequest(request),
      onStderr: (line) => this.debug(`codex: ${line}`),
      onProcessExit: (info) => {
        for (const thread of info.threads) {
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
      const idleForMs = this.deps.idleReapMs ?? DEFAULT_IDLE_REAP_MS;
      this.reapTimer = setInterval(() => {
        void (async () => {
          try {
            const result = await runtime.reapIdleProviderSessions({
              idleForMs,
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
      settled: false,
      finishCommit: beginAgentTurnCommit(this.deps.git, args.threadId),
    });
    void this.dispatchTurn(args).catch((error: unknown) => {
      this.failTurn(args.threadId, error);
    });
  }

  private async dispatchTurn(args: TurnDriverStartArgs): Promise<void> {
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
    const instructions = loadAgentInstructions(this.deps.vaultDir);
    const persisted = getThread(this.deps.db, threadId)?.providerThreadId ?? null;
    if (persisted !== null) {
      try {
        const resumed = await runtime.resumeThread({
          threadId,
          providerThreadId: persisted,
          providerId: CODEX_PROVIDER_ID,
          options: this.options,
          ...(instructions !== undefined ? { instructions } : {}),
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
      ...(instructions !== undefined ? { instructions } : {}),
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
    const resolution =
      interaction.resolution === null
        ? null
        : parseInteractionResolution(interaction.resolution, waiter.payload);
    if (resolution === null) {
      this.debug(
        `interaction ${interaction.id} resolved with an unparseable resolution; denying the provider`,
      );
      waiter.resolve({ decision: "deny" });
      return;
    }
    waiter.resolve(resolution);
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
      const mapped = mapProviderEvent(event, state.ourTurnId);
      if (mapped.kind === "mapped") {
        this.sink.ingestProviderEvents(threadId, [mapped.event]);
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

    const mapped = mapProviderEvent(event, hostTurnId);
    if (mapped.kind === "dropped") {
      this.debug(`dropped provider event for thread ${threadId}: ${mapped.reason}`);
      return;
    }
    this.sink.ingestProviderEvents(threadId, [mapped.event]);

    if (event.type === "turn/completed") {
      this.settleTurn(threadId);
    }
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
      return parseInteractionResolution(row.resolution, payload) ?? { decision: "deny" };
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

  /** Deny every parked approval for the thread; their rows are interrupted
   *  by the caller's `interruptOpenPendingInteractions`. */
  private cancelThreadWaiters(threadId: string): void {
    // Snapshot first: the loop deletes entries mid-iteration.
    const waiters = Array.from(this.waitersByInteractionId);
    for (const [id, waiter] of waiters) {
      if (waiter.threadId !== threadId) {
        continue;
      }
      this.waitersByInteractionId.delete(id);
      waiter.resolve({ decision: "deny" });
    }
  }

  private settleTurn(threadId: string): void {
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined || state.settled) {
      return;
    }
    state.settled = true;
    this.turnsByThreadId.delete(threadId);
    this.cancelThreadWaiters(threadId);
    interruptOpenPendingInteractions(this.deps.db, this.deps.notifier, threadId);
    void state.finishCommit().catch((error: unknown) => {
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
    if (this.reapTimer !== null) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    const waiters = Array.from(this.waitersByInteractionId);
    for (const [id, waiter] of waiters) {
      this.waitersByInteractionId.delete(id);
      waiter.resolve({ decision: "deny" });
    }
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
      const created = new CodexTurnDriver(sink, deps);
      driver = created;
      return created;
    },
    async dispose() {
      await driver?.dispose();
    },
  };
}
