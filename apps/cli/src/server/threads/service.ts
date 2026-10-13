// only the service opens a transaction, and what a step notified flushes after its commit. driver
// dispatch is the one step after commit: a scripted driver re-enters ingest synchronously and a
// transaction cannot nest, so a dispatch failure is folded back in its own.

import { unanswerableReason } from "@repo/domain/pending-interactions";
import { writeTransaction } from "@repo/db/connection";
import type { DbConnection, DbTransaction, SyncResult } from "@repo/db/connection";
import { appendEventsInTransaction } from "@repo/db/events";
import type { SyncedEventInput } from "@repo/db/events";
import { NotificationBuffer } from "@repo/domain/notifier";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  getPendingInteraction,
  interruptOpenPendingInteractions,
  resolvePendingInteraction,
} from "@repo/db/pending-interactions";
import { releaseAllQueuedMessageClaims, releaseQueuedMessageClaim } from "@repo/db/queued-messages";
import type { ClaimedQueuedThreadMessageRow } from "@repo/db/queued-messages";
import { createThread, getThread, listRunningThreads } from "@repo/db/threads";
import type { CreateThreadInput } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type {
  AnswerInteractionRequest,
  CreateThreadRequest,
  GetThreadResponse,
  ListThreadsResponse,
  ParsedListThreadsQuery,
  PendingInteraction,
  SendMessageRequest,
  Thread,
  TimelineQuery,
  TimelineResponse,
} from "@repo/contract/local/threads/threads-schema";
import { messageOf } from "../error-message";
import {
  failTurnlessRunInTransaction,
  ingestEvents,
  ingestInTransaction,
  projectLifecycleInTransaction,
} from "./thread-ingest";
import type { IngestArgs, ThreadWrite } from "./thread-ingest";
import type { ThreadOrigins } from "./thread-origins";
import {
  listThreadPage,
  openInteractions,
  threadDetail,
  threadTimeline,
  toWirePendingInteraction,
  wireThread,
} from "./thread-queries";
import { repairPathOnlyOrigins, wedgedRecovery } from "./thread-recovery";
import {
  dispatchOutcomeOf,
  prepareQueuedTurnInTransaction,
  resolveDispatchInTransaction,
  resolveMessageInTransaction,
} from "./thread-send";
import type { DispatchedTurn, DispatchOutcome, SendDecision, SendOutcome } from "./thread-send";
import { archiveInTransaction, requestStopInTransaction } from "./thread-stop";
import type { InterruptOutcome, StopOutcome } from "./thread-stop";
import { ThreadTimelineProjector } from "./timeline-projection";
import { TurnDriverUnavailableError, unavailableTurnDriver } from "./turn-driver";
import type { TurnDriver, ProviderEventSink } from "./turn-driver";

export type AnswerInteractionOutcome =
  | { kind: "resolved"; interaction: PendingInteraction }
  | { kind: "not-found" }
  | { kind: "already-resolved" }
  | { kind: "invalid-resolution"; message: string };

export { ThreadEventThreadIdMismatchError } from "./thread-event-mismatch-error";

// inside the transaction that writes the events: an event is owed to the account's log exactly when it is in the local one.
export interface ThreadSyncHooks {
  enqueue: (tx: DbTransaction, events: readonly ThreadEvent[]) => void;
}

export interface ThreadServiceArgs {
  db: DbConnection;
  notifier: DbNotifier;
  origins: ThreadOrigins;
  sync?: ThreadSyncHooks;
}

export class ThreadService implements ProviderEventSink {
  private readonly db: DbConnection;
  private readonly notifier: DbNotifier;
  // until a driver is attached, a send is refused as with no agent.
  private driver: TurnDriver = unavailableTurnDriver;
  private readonly timelines: ThreadTimelineProjector;
  private readonly origins: ThreadOrigins;
  private readonly sync: ThreadSyncHooks | null;

  constructor(args: ThreadServiceArgs) {
    this.db = args.db;
    this.notifier = args.notifier;
    this.origins = args.origins;
    this.sync = args.sync ?? null;
    this.timelines = new ThreadTimelineProjector(args.db);
  }

  // after construction: a driver reports through this service, so it is built on it.
  attachDriver(driver: TurnDriver): void {
    this.driver = driver;
  }

  // a method rather than constructor work because it writes. it settles and frees, and never
  // removes an event: the timeline projection reads each thread's log as append-only.
  boot(): void {
    // before the sweep: a claim held by the dead process hides its message from
    // both the queue read and the next drain. a swept row does not auto-dispatch: the next send starts it first.
    releaseAllQueuedMessageClaims(this.db);
    this.recoverWedgedThreads();
  }

  async repairPathOnlyOrigins(): Promise<void> {
    await repairPathOnlyOrigins(this.db, this.origins);
  }

  private transact<T>(step: (write: ThreadWrite) => SyncResult<T>): T {
    const buffer = new NotificationBuffer();
    const result = writeTransaction<T>(this.db, (tx) =>
      step({
        appendLocal: (events) => {
          appendEventsInTransaction(tx, events);
          this.sync?.enqueue(tx, events);
        },
        buffer,
        tx,
      }),
    );
    buffer.flushTo(this.notifier);
    return result;
  }

  async create(input: CreateThreadRequest): Promise<Thread> {
    const created: CreateThreadInput = {};
    if (input.title !== undefined) {
      created.title = input.title;
    }
    if (input.originDocPath !== undefined) {
      created.origin = {
        noteId: await this.origins.noteIdAt(input.originDocPath),
        path: input.originDocPath,
      };
    }
    return await wireThread(this.db, this.origins, createThread(this.db, this.notifier, created));
  }

  async list(query: ParsedListThreadsQuery): Promise<ListThreadsResponse> {
    return await listThreadPage(this.db, this.origins, query);
  }

  async get(threadId: string): Promise<GetThreadResponse | null> {
    return await threadDetail(this.db, this.origins, threadId);
  }

  listInteractions(threadId: string | undefined): PendingInteraction[] {
    return openInteractions(this.db, threadId);
  }

  // the stop comes after the archive: a settled stop drains the queue, and only an archived thread
  // refuses the turn that drain would start.
  async archive(threadId: string): Promise<Thread | null> {
    if (!this.transact((write) => archiveInTransaction(write, threadId))) {
      return null;
    }
    this.stop(threadId);
    const thread = getThread(this.db, threadId);
    return thread === null ? null : await wireThread(this.db, this.origins, thread);
  }

  async interrupt(threadId: string): Promise<InterruptOutcome> {
    const outcome = this.stop(threadId);
    return outcome.kind === "answered"
      ? { ...outcome, thread: await wireThread(this.db, this.origins, outcome.thread) }
      : outcome;
  }

  private stop(threadId: string): StopOutcome {
    const decision = this.transact((write) => requestStopInTransaction(write, threadId));
    if (decision.kind === "done") {
      return decision.outcome;
    }
    const interrupt = this.driver.interruptTurn(threadId);
    if (interrupt === "not-running") {
      this.settleStop(threadId, decision.turnId);
    }
    const thread = getThread(this.db, threadId);
    if (thread === null) {
      return { kind: "not-found" };
    }
    return { kind: "answered", stop: interrupt === "settling" ? "requested" : "stopped", thread };
  }

  // nothing at a provider will ever report this turn's end, so the stop settles here.
  private settleStop(threadId: string, turnId: string | null): void {
    const claimed = this.transact((write) =>
      projectLifecycleInTransaction(write, {
        drain: true,
        event: { turnId, type: "stop.settled" },
        threadId,
      }),
    );
    if (claimed !== null) {
      this.dispatchQueuedMessage(threadId, claimed);
    }
  }

  send(request: SendMessageRequest): SendOutcome {
    const decision = this.transact((write) => resolveMessageInTransaction(write, request));
    return this.runSendDecision(request.threadId, decision);
  }

  // what the send decided, carried out after its commit: the driver may report back through ingest.
  private runSendDecision(threadId: string, decision: SendDecision): SendOutcome {
    switch (decision.kind) {
      case "dispatch": {
        return this.dispatchTurn(decision);
      }
      case "drain": {
        this.dispatchQueuedMessage(threadId, decision.claimed);
        return decision.outcome;
      }
      case "done": {
        return decision.outcome;
      }
      // no default
    }
  }

  // a phone's request lands through the send's own decision, so it starts, queues or is refused
  // exactly as a message typed here would. the phone's thread id is kept, and a new thread takes
  // the note it was asked over, read and never minted: a mint waits on the vault's lock, and a
  // claim held past its lapse is the same request running on a second Mac.
  async acceptDispatch(dispatch: DispatchedTurn): Promise<DispatchOutcome> {
    const origin =
      dispatch.originDocPath === undefined || getThread(this.db, dispatch.threadId) !== null
        ? undefined
        : {
            noteId: await this.origins.noteIdOf(dispatch.originDocPath),
            path: dispatch.originDocPath,
          };
    const decision = this.transact((write) =>
      resolveDispatchInTransaction(write, dispatch, origin),
    );
    if (decision.kind !== "send") {
      return decision;
    }
    return dispatchOutcomeOf(
      dispatch.threadId,
      this.runSendDecision(dispatch.threadId, decision.send),
    );
  }

  private dispatchTurn(decision: Extract<SendDecision, { kind: "dispatch" }>): SendOutcome {
    try {
      this.driver.startTurn({
        ...decision.turn,
        threadId: decision.threadId,
        turnId: decision.turnId,
      });
    } catch (error) {
      this.failTurnlessRun(decision.threadId, messageOf(error));
      return error instanceof TurnDriverUnavailableError
        ? { kind: "provider-unavailable", message: error.message }
        : { kind: "dispatch-failed" };
    }
    return { kind: "started", turnId: decision.turnId };
  }

  private failTurnlessRun(threadId: string, message: string): void {
    this.transact((write) => {
      failTurnlessRunInTransaction(write, threadId, message);
    });
  }

  timeline(query: TimelineQuery): TimelineResponse | null {
    return threadTimeline(this.db, this.timelines, query);
  }

  answerInteraction(request: AnswerInteractionRequest): AnswerInteractionOutcome {
    const existing = getPendingInteraction(this.db, request.interactionId);
    if (existing === null || existing.threadId !== request.threadId) {
      return { kind: "not-found" };
    }
    // the runtime's answer path runs the same check, so a decision this takes is never denied
    // downstream; an unreadable payload leaves it to the waiter's own copy.
    const invalid =
      existing.payload === null ? null : unanswerableReason(existing.payload, request.decision);
    if (invalid !== null) {
      return { kind: "invalid-resolution", message: invalid };
    }
    const outcome = resolvePendingInteraction(this.db, this.notifier, {
      decision: request.decision,
      id: request.interactionId,
      threadId: request.threadId,
    });
    switch (outcome.kind) {
      case "resolved": {
        const interaction = toWirePendingInteraction(outcome.interaction);
        // after the row is resolved: a crash between the two leaves a resolved
        // row and a provider request the turn-end timeout settles.
        this.driver.onInteractionResolved?.(interaction);
        return { interaction, kind: "resolved" };
      }
      case "already-resolved": {
        return { kind: "already-resolved" };
      }
      case "not-found": {
        return { kind: "not-found" };
      }
      // no default
    }
  }

  ingestProviderEvents(threadId: string, events: readonly ThreadEvent[]): void {
    this.ingest({ events, origin: "local", threadId });
  }

  // the same ingest, marked remote: the thread row is created with the log's
  // id, nothing is enqueued back to the outbox (two devices would echo forever),
  // and a settle does not drain this device's queue — the turn ran elsewhere.
  applySyncedEvents(args: {
    threadId: string;
    rows: readonly SyncedEventInput[];
    cursor: number;
  }): void {
    this.ingest({
      cursor: args.cursor,
      origin: "remote",
      rows: args.rows,
      threadId: args.threadId,
    });
  }

  private ingest(args: IngestArgs): void {
    if (ingestEvents(args).length === 0) {
      return;
    }
    const ingested = this.transact((write) => ingestInTransaction(write, args));
    // archived on another device, it stops here as a local archive stops it; a turn that device
    // runs is its own to stop.
    if (ingested.archived) {
      this.stop(args.threadId);
    }
    for (const claimed of ingested.drains) {
      this.dispatchQueuedMessage(args.threadId, claimed);
    }
  }

  private dispatchQueuedMessage(threadId: string, claimed: ClaimedQueuedThreadMessageRow): void {
    const decision = this.transact((write) =>
      prepareQueuedTurnInTransaction(write, threadId, claimed),
    );
    if (decision.kind !== "dispatch") {
      // prepare appended nothing (archived between settle and drain): release, never consume.
      releaseQueuedMessageClaim(this.db, this.notifier, claimed);
      return;
    }
    this.dispatchTurn(decision);
  }

  private recoverWedgedThreads(): void {
    for (const thread of listRunningThreads(this.db)) {
      const recovery = wedgedRecovery(this.db, thread);
      if (recovery === null) {
        continue;
      }
      switch (recovery.kind) {
        case "turnless": {
          this.failTurnlessRun(thread.id, recovery.message);
          break;
        }
        case "turn": {
          this.ingest({ events: recovery.events, origin: "recovery", threadId: thread.id });
          break;
        }
        // no default
      }
      // the provider requests behind these rows died with the old process; a restarted provider raises fresh rows.
      interruptOpenPendingInteractions(this.db, this.notifier, thread.id);
    }
  }
}
