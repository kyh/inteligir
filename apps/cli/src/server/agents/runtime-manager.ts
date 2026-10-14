// the runtime scopes every event by the host's turn id, and one naming any turn but the running one
// is dropped: a session the host gave up on closes asynchronously, while the settle that gave up on
// it can already dispatch the next turn. a turn holds the vault's commit hold, which defers
// auto-commit and blocks sync, so a provider that hangs rather than exiting is bounded by the
// watchdog rather than trusted.

import { createHash } from "node:crypto";
import { createAcpAgentRuntime } from "@repo/agent-runtime/acp/acp-runtime";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { HarnessModels } from "@repo/agent-runtime/acp/harness-registry";
import { describeProviderError, readProviderError } from "@repo/agent-runtime/acp/provider-error";
import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { DbConnection } from "@repo/db/connection";
import { parseHarnessId } from "@repo/domain/harness";
import type { HarnessId, ThreadHarness } from "@repo/domain/harness";
import type { DbNotifier } from "@repo/domain/notifier";
import { interruptOpenPendingInteractions } from "@repo/db/pending-interactions";
import { getThread, setThreadProviderSession } from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import type { PendingInteraction } from "@repo/contract/local/threads/threads-schema";
import type { DebugLog } from "../debug-log";
import { messageOf } from "../error-message";
import { setMostRecent } from "../evict-oldest";
import { providerFailureMessage } from "../threads/provider-failure";
import { TurnDriverUnavailableError } from "../threads/turn-driver";
import type {
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
  TurnInterrupt,
} from "../threads/turn-driver";
import type { GitEngine } from "../vault/git-engine";
import { beginAgentTurnWrites, createVaultPathResolver } from "./agent-commits";
import type { AgentTurnWrites, VaultPathResolver } from "./agent-commits";
import { toInstructions } from "./agent-instructions";
import { toShellEnv } from "./agent-shell-env";
import type { AgentSessionFacts } from "./agent-shell-env";
import { ProviderEventCoalescer } from "./event-coalescer";
import { createInteractionWaiters } from "./interaction-waiters";
import type { InteractionWaiters } from "./interaction-waiters";
import { turnPromptInput } from "./view-context-prompt";

const instructionsHash = (instructions: string): string =>
  createHash("sha256").update(instructions).digest("hex");

const unshippedHarnessDetail = (id: string): string =>
  `This action runs on an agent this copy of inteligir does not have ("${id}") — update inteligir to continue it`;

// the persisted grammar takes every kind the mapper emits but an adapter's notice, which the agent
// log alone reads until one earns a renderer.
type PersistedProviderEvent = Exclude<ProviderEvent, { type: "provider/notice" }>;

// the runtime reports a refusal in its adapter's words and the host words it for the person, so
// the one persisted message names the harness this turn ran on.
const wordFailure = (event: PersistedProviderEvent, harness: HarnessId): PersistedProviderEvent =>
  event.type === "provider/error" && event.failure !== undefined
    ? { ...event, message: providerFailureMessage(event.failure, harness, event.message) }
    : event;

type FileChangeProviderItem = Extract<
  Extract<ProviderEvent, { type: "item/started" }>["item"],
  { type: "fileChange" }
>;

const IDLE_SESSION = { afterMs: 10 * 60_000, everyMs: 60_000 };

// idle time, not wall time: a streaming turn is working and a parked approval has its own clock.
// what is left is a provider that accepted a turn and went silent, which no other path settles.
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 10 * 60_000;

// a sweep over per-turn timestamps: a streaming turn produces thousands of frames, and
// re-arming a timeout per frame buys nothing over a bounded-lag check.
const WATCHDOG_SWEEP_INTERVAL_MS = 1000;

// an evicted thread re-sends its instructions once, which costs a prompt block and nothing else.
const RESIDENT_INSTRUCTION_HASHES = 512;

// long enough for an agent to stop the tools it started, short enough that a stop still reads
// as a brake to someone watching the vault change.
const DEFAULT_STOP_GRACE_MS = 5000;

export interface AcpTurnDriverDeps {
  db: DbConnection;
  notifier: DbNotifier;
  vaultDir: string;
  git: GitEngine;
  models: HarnessModels;
  // a getter read at every session open, never a value: connected folders are settings-mutable,
  // and a value read once would tell every later session the set the first one saw.
  sessionFacts: () => AgentSessionFacts;
  hostEnv: NodeJS.ProcessEnv;
  // a getter: the stored default can change between two thread starts
  defaultProviderId: () => HarnessId;
  // read per send with the thread's own harness: non-null refuses the turn with it before
  // anything is spawned. absent, every send is attempted.
  unavailableReason?: (harness: HarnessId) => string | null;
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"];
  createRuntime?: typeof createAcpAgentRuntime;
  // null disables.
  turnIdleTimeoutMs?: number | null;
  // how long a cancelled turn has to end itself before its session is closed.
  stopGraceMs?: number;
  onDebug?: (message: string) => void;
  // INTELIGIR_DEBUG's acp trace, beside onDebug's always-on log.
  debugLog?: DebugLog | undefined;
}

// a started turn the user stopped carries the timer that closes its session if it never ends.
type TurnPhase =
  | { kind: "dispatched" }
  | { kind: "started"; stopDeadline: ReturnType<typeof setTimeout> | null };

// in the map from startTurn until the turn settles, so membership is the unsettled test.
interface ActiveTurn {
  ourTurnId: string;
  harness: HarnessId;
  phase: TurnPhase;
  writes: AgentTurnWrites;
  lastEventAt: number;
}

export class AcpTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: AcpTurnDriverDeps;
  private readonly resolveVaultPath: VaultPathResolver;
  private readonly runtime: AgentRuntime;
  private readonly events = new ProviderEventCoalescer((threadId, batch) => {
    this.sink.ingestProviderEvents(threadId, batch);
  });
  private readonly turnsByThreadId = new Map<string, ActiveTurn>();
  // what each thread's provider session was last handed, so a session/load that carries it in its
  // own history is not handed it again; in memory, so a restart re-sends once.
  private readonly instructionHashes = new Map<string, string>();
  private readonly waiters: InteractionWaiters;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(sink: ProviderEventSink, deps: AcpTurnDriverDeps) {
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
    this.runtime = (deps.createRuntime ?? createAcpAgentRuntime)({
      debugLog: deps.debugLog,
      idleSession: IDLE_SESSION,
      models: deps.models,
      onActivity: (threadId) => {
        this.noteTurnActivity(threadId);
      },
      onDiagnostic: (message) => {
        this.debug(message);
      },
      onEvent: (event) => {
        this.onRuntimeEvent(event);
      },
      onInteractiveRequest: async (request) => await this.onInteractiveRequest(request),
      onStderr: (line) => {
        this.debug(`agent: ${line}`);
      },
      // spread: AgentShellEnv is an interface, which a string record does not take.
      shellEnv: () => ({ ...toShellEnv(deps.sessionFacts(), deps.hostEnv) }),
      spawnAdapter: deps.spawnAdapter,
      workspacePath: deps.vaultDir,
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

  // fire and forget: a failure is the agent log's to read, never the caller's to handle.
  private background(what: string, work: Promise<unknown>): void {
    void (async () => {
      try {
        await work;
      } catch (error) {
        this.debug(`${what} failed: ${messageOf(error)}`);
      }
    })();
  }

  startTurn(args: TurnDriverStartArgs): void {
    if (this.disposed) {
      throw new Error("The agent runtime manager is disposed");
    }
    const harness = this.harnessOf(getThread(this.deps.db, args.threadId));
    if (harness.kind === "unknown") {
      throw new TurnDriverUnavailableError(unshippedHarnessDetail(harness.id));
    }
    const unavailable = this.deps.unavailableReason?.(harness.id) ?? null;
    if (unavailable !== null) {
      throw new TurnDriverUnavailableError(unavailable);
    }
    if (this.turnsByThreadId.has(args.threadId)) {
      throw new Error(`Thread ${args.threadId} already has a running turn`);
    }
    this.turnsByThreadId.set(args.threadId, {
      harness: harness.id,
      lastEventAt: Date.now(),
      ourTurnId: args.turnId,
      phase: { kind: "dispatched" },
      writes: beginAgentTurnWrites({
        git: this.deps.git,
        notifier: this.deps.notifier,
        onError: (message) => {
          this.debug(message);
        },
        threadId: args.threadId,
        turnId: args.turnId,
      }),
    });
    void this.runDispatch(args, harness.id);
  }

  private async runDispatch(args: TurnDriverStartArgs, harness: HarnessId): Promise<void> {
    try {
      await this.dispatchTurn(args, harness);
    } catch (error) {
      // a disposed driver leaves its turns to the next boot's recovery; a turn the watchdog settled
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
    if (this.disposed) {
      throw new Error("The agent runtime manager is disposed");
    }
    if (!this.isDispatching(args)) {
      throw new Error(`Turn ${args.turnId} settled before its dispatch finished`);
    }
  }

  // a provider the host gave up on must not carry the settled turn into the next one, nor be
  // trusted to have kept the instructions it was handed.
  private abandonProviderSession(threadId: string): void {
    this.instructionHashes.delete(threadId);
    this.background(
      `closing the provider session for thread ${threadId}`,
      this.runtime.closeThread(threadId),
    );
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

  private async dispatchTurn(args: TurnDriverStartArgs, harness: HarnessId): Promise<void> {
    // the hold blocks new sync passes; this waits out one already mid-flight, so the provider
    // never writes into a rebase's checkout window.
    await this.turnsByThreadId.get(args.threadId)?.writes.ready;
    this.assertDispatching(args);
    // acp's session/new carries no instructions field, so a turn's prompt is the only channel.
    const instructions = this.runtime.hasThread(args.threadId)
      ? undefined
      : await this.openThreadSession(args, harness);
    this.assertDispatching(args);
    await this.runtime.runTurn({
      input: turnPromptInput(args, instructions),
      threadId: args.threadId,
      turnId: args.turnId,
    });
    // recorded once the prompt is on the wire: a dispatch that failed first handed the session nothing.
    if (instructions !== undefined) {
      setMostRecent(
        this.instructionHashes,
        args.threadId,
        instructionsHash(instructions),
        RESIDENT_INSTRUCTION_HASHES,
      );
    }
  }

  // a fresh session is handed the instructions; a loaded one already holds the last set in its
  // history, so it is handed them again only when they changed (a connected folder, AGENTS.md).
  private instructionsFor(threadId: string, loaded: boolean): string | undefined {
    const instructions = toInstructions(this.deps.sessionFacts(), this.deps.vaultDir);
    if (loaded && this.instructionHashes.get(threadId) === instructionsHash(instructions)) {
      return undefined;
    }
    return instructions;
  }

  private async openThreadSession(
    args: TurnDriverStartArgs,
    providerId: HarnessId,
  ): Promise<string | undefined> {
    const { threadId } = args;
    const persisted = getThread(this.deps.db, threadId)?.providerThreadId ?? null;
    if (persisted !== null) {
      try {
        const resumed = await this.runtime.resumeThread({
          providerId,
          providerThreadId: persisted,
          threadId,
        });
        setThreadProviderSession(this.deps.db, {
          providerId,
          providerThreadId: resumed.providerThreadId,
          threadId,
        });
        return this.instructionsFor(threadId, resumed.loaded);
      } catch (error) {
        // the provider's rollout can be gone (a cleaned ~/.codex, another machine); a fresh
        // session keeps the thread usable.
        this.debug(
          `resume of thread ${threadId} from provider session ${persisted} failed; starting fresh: ${describeProviderError(error)}`,
        );
      }
      this.assertDispatching(args);
    }
    const started = await this.runtime.startThread({ providerId, threadId });
    setThreadProviderSession(this.deps.db, {
      providerId,
      providerThreadId: started.providerThreadId,
      threadId,
    });
    return this.instructionsFor(threadId, false);
  }

  // a thread with no harness yet starts on the default; one it already has is kept, known or not.
  private harnessOf(row: ThreadRow | null): ThreadHarness {
    const stored = row?.providerId ?? null;
    return stored === null
      ? { id: this.deps.defaultProviderId(), kind: "known" }
      : parseHarnessId(stored);
  }

  interruptTurn(threadId: string): TurnInterrupt {
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined || this.disposed) {
      return "not-running";
    }
    if (state.phase.kind === "dispatched") {
      // nothing reached the provider: the dispatch finds its turn gone at its next await and
      // stops, and what it was opening is closed so the next send opens afresh, instructions first.
      this.settleTurn(threadId);
      this.abandonProviderSession(threadId);
      return "not-running";
    }
    if (state.phase.stopDeadline !== null) {
      return "settling";
    }
    state.phase.stopDeadline = setTimeout(() => {
      this.closeStoppedTurn(threadId, state);
    }, this.deps.stopGraceMs ?? DEFAULT_STOP_GRACE_MS);
    state.phase.stopDeadline.unref();
    // the cancel first: it answers the agent's open permission requests cancelled, and the
    // waiters' deny below only clears the cards.
    this.background(`cancelling the turn on thread ${threadId}`, this.runtime.cancelTurn(threadId));
    this.waiters.cancel(threadId);
    interruptOpenPendingInteractions(this.deps.db, this.deps.notifier, threadId);
    return "settling";
  }

  // an agent that never answered the cancel: closing its session is what stops it, and a closed
  // session reports nothing more, so the host settles the turn itself.
  private closeStoppedTurn(threadId: string, stopped: ActiveTurn): void {
    if (this.disposed || this.turnsByThreadId.get(threadId) !== stopped) {
      return;
    }
    this.debug(
      `turn ${stopped.ourTurnId} on thread ${threadId} did not stop within its grace; closing its session`,
    );
    // closed before the settle, whose ingest can dispatch the next queued turn: that turn must not
    // find this session.
    this.abandonProviderSession(threadId);
    this.settleTurn(threadId);
    this.sink.ingestProviderEvents(threadId, [
      {
        scope: turnScope(stopped.ourTurnId),
        status: "interrupted",
        threadId,
        type: "turn/completed",
      },
    ]);
  }

  onInteractionResolved(interaction: PendingInteraction): void {
    this.waiters.resolve(interaction);
  }

  recordAgentWrites(threadId: string, paths: readonly string[]): void {
    this.turnsByThreadId.get(threadId)?.writes.recordPaths(paths);
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

    if (state?.phase.kind !== "started" || state.ourTurnId !== event.scope.turnId) {
      this.debug(
        `dropped ${event.type} for thread ${threadId}: turn ${event.scope.turnId} is not the running one`,
      );
      return;
    }

    if (event.type === "item/started" && event.item.type === "fileChange") {
      state.writes.claim(this.vaultPathsOf(event.item.changes));
    }
    if (event.type === "item/completed" && event.item.type === "fileChange") {
      state.writes.settle(this.vaultPathsOf(event.item.changes), event.item.status);
    }

    // the agent log is the one place a notice is read until one earns a renderer.
    if (event.type === "provider/notice") {
      this.debug(`adapter notice for thread ${threadId}: ${event.severity}: ${event.message}`);
      return;
    }
    const persisted: ThreadEvent = wordFailure(event, state.harness);
    if (event.type === "turn/completed") {
      // settle before ingest: the ingest transaction drains the queue and can synchronously
      // dispatch the next turn through startTurn, which must find this one released.
      this.settleTurn(threadId);
      this.sink.ingestProviderEvents(threadId, [persisted]);
      return;
    }
    this.events.push(threadId, persisted);
  }

  private onTurnStarted(
    event: Extract<ProviderEvent, { type: "turn/started" }>,
    state: ActiveTurn | undefined,
  ): void {
    const { threadId } = event;
    if (state?.phase.kind !== "dispatched" || state.ourTurnId !== event.scope.turnId) {
      this.debug(
        `dropped ${event.type} for thread ${threadId}: turn ${event.scope.turnId} is not the dispatched one`,
      );
      return;
    }
    state.phase = { kind: "started", stopDeadline: null };
    this.events.push(threadId, event);
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

  // denied, not parked, when it names a turn that is not the running one: that turn's settle has
  // already cleared its cards, so nothing would ever clear this one.
  private async onInteractiveRequest(
    create: PendingInteractionCreate,
  ): Promise<PendingInteractionResolution> {
    const state = this.turnsByThreadId.get(create.threadId);
    if (state?.phase.kind !== "started" || state.ourTurnId !== create.turnId) {
      this.debug(
        `denied an approval for thread ${create.threadId}: turn ${create.turnId} is not the running one`,
      );
      return { decision: "deny" };
    }
    return await this.waiters.park(create);
  }

  private settleTurn(threadId: string): void {
    // buffered deltas must be in the log before anything reads the turn as settled.
    this.events.flush(threadId);
    const state = this.turnsByThreadId.get(threadId);
    if (state === undefined) {
      return;
    }
    if (state.phase.kind === "started" && state.phase.stopDeadline !== null) {
      clearTimeout(state.phase.stopDeadline);
    }
    this.turnsByThreadId.delete(threadId);
    this.waiters.cancel(threadId);
    interruptOpenPendingInteractions(this.deps.db, this.deps.notifier, threadId);
    this.background(`settling the write set for thread ${threadId}`, state.writes.finish());
  }

  // turn-scoped and classed like a refused prompt's: the settle finds the class on the turn's own
  // rows, so a session open refused for a sign-in holds the queue too.
  private failTurn(threadId: string, cause: unknown): void {
    const state = this.turnsByThreadId.get(threadId);
    const reading = readProviderError(cause);
    if (state === undefined) {
      this.debug(
        `dispatch failure for thread ${threadId} after its turn settled: ${reading.adapterMessage}`,
      );
      return;
    }
    const scope = turnScope(state.ourTurnId);
    const events: ThreadEvent[] = [];
    if (state.phase.kind === "dispatched") {
      events.push({ scope, threadId, type: "turn/started" });
    }
    events.push(
      {
        failure: reading.failure,
        message: providerFailureMessage(reading.failure, state.harness, reading.adapterMessage),
        scope,
        threadId,
        type: "provider/error",
      },
      {
        error: { message: reading.adapterMessage },
        scope,
        status: "failed",
        threadId,
        type: "turn/completed",
      },
    );
    this.settleTurn(threadId);
    this.sink.ingestProviderEvents(threadId, events);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.events.flushAll();
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.waiters.cancel();
    await this.runtime.shutdown();
  }
}
