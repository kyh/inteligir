// ingest and send each read, validate, append, project lifecycle and touch the
// queue inside one transaction; notifications flush after commit. driver
// dispatch is the one step after commit: a scripted driver re-enters ingest
// synchronously and a transaction cannot nest, so a dispatch failure is folded
// back in its own.

import {
  approvalPendingInteractionPayloadSchema,
  parseApprovalResolution,
} from "@repo/domain/pending-interactions";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { writeTransaction } from "@repo/db/connection";
import type { DbConnection, DbExecutor, DbTransaction } from "@repo/db/connection";
import {
  appendEventsInTransaction,
  appendSyncedEventsInTransaction,
  listThreadMetaEvents,
  storedTurnCompletion,
  threadHasEvents,
  turnStartOriginDeviceId,
} from "@repo/db/events";
import type { SyncedEventInput } from "@repo/db/events";
import { createTurnId } from "@repo/db/ids";
import { removeOwnSyncedCopiesInTransaction } from "@repo/db/own-synced-copies";
import { NotificationBuffer } from "@repo/domain/notifier";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  getPendingInteraction,
  interruptOpenPendingInteractions,
  listAllOpenPendingInteractions,
  listOpenPendingInteractions,
  resolvePendingInteraction,
} from "@repo/db/pending-interactions";
import type { PendingInteractionRow } from "@repo/db/pending-interactions";
import {
  claimNextQueuedThreadMessageInTransaction,
  createQueuedThreadMessageInTransaction,
  deleteClaimedQueuedThreadMessageInTransaction,
  listQueuedThreadMessages,
  releaseAllQueuedMessageClaims,
  releaseQueuedMessageClaim,
} from "@repo/db/queued-messages";
import type { ClaimedQueuedThreadMessageRow } from "@repo/db/queued-messages";
import { writeSyncCursor } from "@repo/db/sync-outbox";
import {
  applyThreadLifecycleEventInTransaction,
  applyThreadMetaInTransaction,
  archiveThreadInTransaction,
  bindPathOnlyOrigins,
  createThread,
  ensureThreadInTransaction,
  getThread,
  listPathOnlyOriginPaths,
  listRunningThreads,
  listThreads,
  nameUntitledThreadInTransaction,
} from "@repo/db/threads";
import type { CreateThreadInput, ThreadRow } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { deriveThreadTitle } from "@repo/domain/thread-title";
import type { ThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { isThreadRunning } from "@repo/domain/thread-status";
import type {
  AnswerInteractionRequest,
  CreateThreadRequest,
  GetThreadResponse,
  ListThreadsResponse,
  ParsedListThreadsQuery,
  PendingInteraction,
  SendMessageRequest,
  Thread,
  ThreadStop,
  TimelineQuery,
  TimelineResponse,
} from "@repo/api/local/threads/threads-schema";
import {
  encodeThreadListCursor,
  THREADS_LIST_DEFAULT_LIMIT,
} from "@repo/api/local/threads/threads-schema";
import { computeTimelineDelta } from "@repo/api/local/thread-timeline";
import { z } from "zod";
import { mapWithConcurrency } from "../concurrency";
import { messageOf } from "../error-message";
import { ThreadEventThreadIdMismatchError } from "./thread-event-mismatch-error";
import type { ThreadOrigins } from "./thread-origins";
import { ThreadTimelineProjector } from "./timeline-projection";
import { TurnDriverUnavailableError } from "./turn-driver";
import type { CreateTurnDriver, TurnDriver, ProviderEventSink, TurnRequest } from "./turn-driver";

// threads-router switches exhaustively over this, so a new member breaks there rather than becoming a 500.
const SEND_CONFLICT_CODES = ["stale_turn", "archived"] as const;

type SendConflictCode = (typeof SEND_CONFLICT_CODES)[number];

export type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "queued"; queuedMessageId: string }
  | { kind: "not-found" }
  | { kind: "conflict"; error: SendConflictCode; message: string }
  | { kind: "provider-unavailable"; message: string }
  | { kind: "dispatch-failed" };

type QueuedSendOutcome = Extract<SendOutcome, { kind: "queued" }>;

// each path is a note read and maybe a write; a vault of old actions is not opened all at once.
const ORIGIN_BACKFILL_CONCURRENCY = 4;

type SendDecision =
  | {
      kind: "dispatch";
      threadId: string;
      turnId: string;
      turn: TurnRequest;
    }
  // the queue's head starts, and the send that found it answers for its own message, queued behind it.
  | { kind: "drain"; claimed: ClaimedQueuedThreadMessageRow; outcome: QueuedSendOutcome }
  | { kind: "done"; outcome: SendOutcome };

export type InterruptOutcome =
  | { kind: "answered"; stop: ThreadStop; thread: Thread }
  | { kind: "not-found" }
  | { kind: "remote"; message: string };

// the row, not the wire thread: its origin is resolved after the transaction, off the index.
type StopOutcome =
  | { kind: "answered"; stop: ThreadStop; thread: ThreadRow }
  | Exclude<InterruptOutcome, { kind: "answered" }>;

type InterruptDecision =
  | { kind: "interrupt"; turnId: string | null }
  | { kind: "done"; outcome: StopOutcome };

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
  createTurnDriver: CreateTurnDriver;
  origins: ThreadOrigins;
  sync?: ThreadSyncHooks;
}

// a turn another device started answers to that device's provider alone.
const turnRunsElsewhere = (db: DbExecutor, row: ThreadRow): boolean =>
  isThreadRunning(row.status) &&
  row.activeTurnId !== null &&
  turnStartOriginDeviceId(db, { threadId: row.id, turnId: row.activeTurnId }) !== null;

const toWireThread = (
  row: ThreadRow,
  originDocPath: string | null,
  runsElsewhere: boolean,
): Thread => ({
  activeTurnId: row.activeTurnId,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  id: row.id,
  originDocPath,
  providerId: row.providerId,
  runsElsewhere,
  status: row.status,
  title: row.title,
  updatedAt: row.updatedAt,
});

// null for unparseable bytes: deny is always answerable, so it costs one card's detail rather than the thread.
const parseStoredApprovalPayload = (
  payloadJson: string,
): ApprovalPendingInteractionPayload | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const parsed = approvalPendingInteractionPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const toWirePendingInteraction = (row: PendingInteractionRow): PendingInteraction => {
  const payload = parseStoredApprovalPayload(row.payload);
  return {
    createdAt: row.createdAt,
    id: row.id,
    payload,
    requestKey: row.requestKey,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt,
    status: row.status,
    threadId: row.threadId,
    turnId: row.turnId,
  };
};

// the same parse the runtime's answer path runs, so a resolution this passes is never silently denied downstream.
const invalidResolutionMessage = (payloadJson: string, resolution: string): string | null => {
  const payload = parseStoredApprovalPayload(payloadJson);
  if (payload === null) {
    return null;
  }
  const parsed = parseApprovalResolution(resolution, payload);
  return parsed.ok ? null : parsed.reason;
};

const lifecycleEventFor = (event: ThreadEvent): ThreadLifecycleEvent | null => {
  switch (event.type) {
    case "turn/started": {
      return { turnId: event.scope.turnId, type: "run.started" };
    }
    case "turn/completed": {
      const { turnId } = event.scope;
      // an interrupted turn still settled: only a failed one reads as an error.
      return event.status === "failed"
        ? { turnId, type: "run.failed" }
        : { turnId, type: "run.succeeded" };
    }
    case "client/turn/requested":
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/completed":
    case "item/plan/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/started":
    case "provider/error":
    case "thread/archived":
    case "thread/meta":
    case "thread/tokenUsage/updated": {
      return null;
    }
    // no default
  }
};

// a queued message carries no view context: it drains minutes later, long
// after the screen it described; storing one gives away the immediacy that keeps it honest. its
// context paths stay: an @-mention is part of what the user asked.
const queueInTransaction = (
  tx: DbTransaction,
  threadId: string,
  turn: TurnRequest,
  buffer: NotificationBuffer,
): QueuedSendOutcome => {
  const queued = createQueuedThreadMessageInTransaction(tx, {
    contextPaths: turn.contextPaths === undefined ? null : JSON.stringify(turn.contextPaths),
    text: turn.text,
    threadId,
  });
  buffer.notifyThread(threadId, ["queue-changed"]);
  return { kind: "queued", queuedMessageId: queued.id };
};

const storedContextPathsSchema = z.array(z.string().min(1)).min(1);

// only this process writes the column, from a parsed request; bytes that no longer parse cost the
// message its attachments, never the message.
const queuedTurn = (claimed: ClaimedQueuedThreadMessageRow): TurnRequest => {
  if (claimed.contextPaths === null) {
    return { text: claimed.text };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(claimed.contextPaths);
  } catch {
    return { text: claimed.text };
  }
  const parsed = storedContextPathsSchema.safeParse(raw);
  return parsed.success
    ? { contextPaths: parsed.data, text: claimed.text }
    : { text: claimed.text };
};

// a send's request also carries its routing (the thread, the turn it expects), which is no part of
// what the turn carries to the driver.
const requestedTurn = (request: SendMessageRequest): TurnRequest => ({
  contextPaths: request.contextPaths,
  text: request.text,
  viewContext: request.viewContext,
});

// the first message a thread carries names it, whichever client sent it and on whichever device.
const nameThreadFromRequestsInTransaction = (
  tx: DbTransaction,
  threadId: string,
  events: readonly ThreadEvent[],
  buffer: NotificationBuffer,
): void => {
  for (const event of events) {
    if (event.type !== "client/turn/requested") {
      continue;
    }
    const title = deriveThreadTitle(event.text);
    if (title === null) {
      continue;
    }
    if (nameUntitledThreadInTransaction(tx, { threadId, title })) {
      buffer.notifyThread(threadId, ["title-changed"]);
    }
    return;
  }
};

type ThreadMetaEvent = Extract<ThreadEvent, { type: "thread/meta" }>;

// the thread's own facts, whichever device stated them; answers whether a row archived it here.
const projectThreadFactsInTransaction = (
  tx: DbTransaction,
  threadId: string,
  events: readonly ThreadEvent[],
  buffer: NotificationBuffer,
): boolean => {
  let archived = false;
  for (const event of events) {
    if (event.type === "thread/meta") {
      const change = applyThreadMetaInTransaction(tx, { facts: event, threadId });
      if (change.title) {
        buffer.notifyThread(threadId, ["title-changed"]);
      }
      if (change.origin) {
        buffer.notifyThread(threadId, ["origin-changed"]);
      }
    } else if (event.type === "thread/archived" && archiveThreadInTransaction(tx, threadId)) {
      buffer.notifyThread(threadId, ["archived-changed"]);
      archived = true;
    }
  }
  return archived;
};

// what a thread is as its first request leaves it: the name that request gave it and the note it
// was started over. its harness is stated once a provider starts a turn on it.
const threadIdentity = (row: ThreadRow): ThreadMetaEvent | null => {
  const meta: ThreadMetaEvent = { scope: threadScope(), threadId: row.id, type: "thread/meta" };
  if (row.title !== null) {
    meta.title = row.title;
  }
  if (row.originDocPath !== null) {
    meta.originDocPath = row.originDocPath;
    if (row.originNoteId !== null) {
      meta.originNoteId = row.originNoteId;
    }
  }
  return meta.title === undefined && meta.originDocPath === undefined ? null : meta;
};

// a queued reply follows the turn it waited on however that turn ended, a stop included: it is
// claimed here, in the settle's transaction, and dispatched after commit.
const projectLifecycleInTransaction = (
  tx: DbTransaction,
  args: { threadId: string; event: ThreadLifecycleEvent; drain: boolean },
  buffer: NotificationBuffer,
): ClaimedQueuedThreadMessageRow | null => {
  const { threadId, event } = args;
  const outcome = applyThreadLifecycleEventInTransaction(tx, { event, threadId });
  if (!outcome.applied) {
    // a late completion for a superseded turn is expected traffic.
    console.warn(
      `thread ${threadId}: ${event.type} not applied (${outcome.reason}): ${outcome.detail}`,
    );
    return null;
  }
  buffer.notifyThread(threadId, ["status-changed"]);
  if (isThreadRunning(outcome.thread.status) || !args.drain) {
    return null;
  }
  const claimed = claimNextQueuedThreadMessageInTransaction(tx, threadId);
  if (claimed !== null) {
    buffer.notifyThread(threadId, ["queue-changed"]);
  }
  return claimed;
};

// a turn another device runs is refused: its provider answers to that process alone.
const requestStopInTransaction = (
  tx: DbTransaction,
  threadId: string,
  buffer: NotificationBuffer,
): InterruptDecision => {
  const thread = getThread(tx, threadId);
  if (thread === null) {
    return { kind: "done", outcome: { kind: "not-found" } };
  }
  switch (thread.status) {
    case "idle":
    case "error": {
      return { kind: "done", outcome: { kind: "answered", stop: "not-running", thread } };
    }
    case "starting":
    case "active":
    case "stopping": {
      if (turnRunsElsewhere(tx, thread)) {
        return {
          kind: "done",
          outcome: { kind: "remote", message: "That turn is running on another device" },
        };
      }
      // a second stop finds the thread already stopping, and asks the driver again.
      const requested = applyThreadLifecycleEventInTransaction(tx, {
        event: { type: "stop.requested" },
        threadId,
      });
      if (requested.applied) {
        buffer.notifyThread(threadId, ["status-changed"]);
      }
      return { kind: "interrupt", turnId: thread.activeTurnId };
    }
    // no default
  }
};

export class ThreadService implements ProviderEventSink {
  private readonly db: DbConnection;
  private readonly notifier: DbNotifier;
  private readonly driver: TurnDriver;
  private readonly timelines: ThreadTimelineProjector;
  private readonly origins: ThreadOrigins;
  private readonly sync: ThreadSyncHooks | null;

  constructor(args: ThreadServiceArgs) {
    this.db = args.db;
    this.notifier = args.notifier;
    this.origins = args.origins;
    this.sync = args.sync ?? null;
    this.timelines = new ThreadTimelineProjector(args.db);
    this.driver = args.createTurnDriver(this);
  }

  // a method rather than constructor work because it writes.
  boot(): void {
    // first: a removed copy can be all that holds a thread running, and the sweep would fail a
    // turn that finished.
    this.removeOwnSyncedCopies();
    // before the sweep: a claim held by the dead process hides its message from
    // both the queue read and the next drain. a swept row does not auto-dispatch: the next send starts it first.
    releaseAllQueuedMessageClaims(this.db);
    this.recoverWedgedThreads();
  }

  // a thread bound by its path alone loses its note to a rename, so each such path takes the id its
  // note carries, minted through the create's own guarded step; a note that is gone or cannot take
  // one leaves its threads on the path. a bound row is never listed again, so a rerun reads only
  // the paths still without one.
  async backfillOriginNoteIds(): Promise<void> {
    await mapWithConcurrency(
      listPathOnlyOriginPaths(this.db),
      ORIGIN_BACKFILL_CONCURRENCY,
      async (path) => {
        let noteId: string | null;
        try {
          noteId = await this.origins.noteIdAt(path);
        } catch (error) {
          // one note's fault costs its threads the id until the next boot, never the sweep.
          console.warn(`thread origins: ${path} stays bound by path: ${messageOf(error)}`);
          return;
        }
        if (noteId !== null) {
          bindPathOnlyOrigins(this.db, { noteId, path });
        }
      },
    );
  }

  // a copy's turn/started re-opened a turn its original had already settled, and when the
  // turn's end never came back under that id nothing settled it again: such a thread takes the
  // end its own rows state. lifecycle is not folded from the rows whole, because a stop settled
  // here and a start that never produced a turn move it without writing one.
  private removeOwnSyncedCopies(): void {
    const buffer = new NotificationBuffer();
    writeTransaction(this.db, (tx) => {
      for (const threadId of removeOwnSyncedCopiesInTransaction(tx).threadIds) {
        const thread = getThread(tx, threadId);
        if (thread === null || thread.activeTurnId === null || !isThreadRunning(thread.status)) {
          continue;
        }
        const completion = storedTurnCompletion(tx, { threadId, turnId: thread.activeTurnId });
        const settle = completion === null ? null : lifecycleEventFor(completion);
        if (settle !== null) {
          projectLifecycleInTransaction(tx, { drain: false, event: settle, threadId }, buffer);
        }
      }
    });
    buffer.flushTo(this.notifier);
  }

  // every local append goes through here so the outbox enqueue rides the same
  // transaction; a site that skipped it would drop events out of sync with no symptom.
  private appendLocal(tx: DbTransaction, events: readonly ThreadEvent[]): void {
    appendEventsInTransaction(tx, events);
    this.sync?.enqueue(tx, events);
  }

  // a provider started a turn here, so the harness the row names is bound: the log states it once,
  // and another device keeps it. the session id is this device's alone and never travels.
  private stateHarnessInTransaction(tx: DbTransaction, threadId: string): void {
    const providerId = getThread(tx, threadId)?.providerId ?? null;
    if (
      providerId === null ||
      listThreadMetaEvents(tx, threadId).some((meta) => meta.providerId !== undefined)
    ) {
      return;
    }
    this.appendLocal(tx, [{ providerId, scope: threadScope(), threadId, type: "thread/meta" }]);
  }

  // a thread reaches another device with its first request, so a fact about one that never made
  // one stays here: sent alone, it would arrive there as an empty action.
  private announceInTransaction(
    tx: DbTransaction,
    fact: ThreadEvent,
    buffer: NotificationBuffer,
  ): void {
    if (!threadHasEvents(tx, fact.threadId)) {
      return;
    }
    this.appendLocal(tx, [fact]);
    buffer.notifyThread(fact.threadId, ["events-appended"]);
  }

  // the stored path answers for a note with no id, or one no indexed doc carries any more.
  private async toWire(row: ThreadRow): Promise<Thread> {
    const { originDocPath, originNoteId } = row;
    const runsElsewhere = turnRunsElsewhere(this.db, row);
    if (originDocPath === null || originNoteId === null) {
      return toWireThread(row, originDocPath, runsElsewhere);
    }
    const resolved = await this.origins.pathForNoteId(originNoteId, originDocPath);
    return toWireThread(row, resolved ?? originDocPath, runsElsewhere);
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
    return await this.toWire(createThread(this.db, this.notifier, created));
  }

  async list(query: ParsedListThreadsQuery): Promise<ListThreadsResponse> {
    const path = query.originDocPath ?? null;
    const page = listThreads(this.db, {
      after: query.cursor ?? null,
      contains: query.query ?? null,
      includeArchived: query.includeArchived ?? false,
      limit: query.limit ?? THREADS_LIST_DEFAULT_LIMIT,
      origin: path === null ? null : { noteId: await this.origins.noteIdOf(path), path },
      running: query.running ?? false,
    });
    const threads = await Promise.all(page.rows.map(async (row) => await this.toWire(row)));
    return {
      nextCursor: page.next === null ? null : encodeThreadListCursor(page.next),
      // the page is narrowed by the stored path or the note's id; the answer is where each row
      // resolves now, so a row whose note moved away leaves the page short, never wrong.
      threads: path === null ? threads : threads.filter((thread) => thread.originDocPath === path),
    };
  }

  async get(threadId: string): Promise<GetThreadResponse | null> {
    const thread = getThread(this.db, threadId);
    if (thread === null) {
      return null;
    }
    return {
      pendingInteractions: listOpenPendingInteractions(this.db, threadId).map(
        toWirePendingInteraction,
      ),
      queuedMessages: listQueuedThreadMessages(this.db, threadId).map((row) => ({
        createdAt: row.createdAt,
        id: row.id,
        text: row.text,
      })),
      thread: await this.toWire(thread),
    };
  }

  listInteractions(threadId: string | undefined): PendingInteraction[] {
    const rows =
      threadId === undefined
        ? listAllOpenPendingInteractions(this.db)
        : listOpenPendingInteractions(this.db, threadId);
    return rows.map(toWirePendingInteraction);
  }

  // the stop comes after the archive: a settled stop drains the queue, and only an archived thread
  // refuses the turn that drain would start.
  async archive(threadId: string): Promise<Thread | null> {
    const buffer = new NotificationBuffer();
    const found = writeTransaction(this.db, (tx) => {
      if (getThread(tx, threadId) === null) {
        return false;
      }
      if (archiveThreadInTransaction(tx, threadId)) {
        buffer.notifyThread(threadId, ["archived-changed"]);
        this.announceInTransaction(
          tx,
          { scope: threadScope(), threadId, type: "thread/archived" },
          buffer,
        );
      }
      return true;
    });
    buffer.flushTo(this.notifier);
    if (!found) {
      return null;
    }
    this.stop(threadId);
    const thread = getThread(this.db, threadId);
    return thread === null ? null : await this.toWire(thread);
  }

  async interrupt(threadId: string): Promise<InterruptOutcome> {
    const outcome = this.stop(threadId);
    return outcome.kind === "answered"
      ? { ...outcome, thread: await this.toWire(outcome.thread) }
      : outcome;
  }

  private stop(threadId: string): StopOutcome {
    const buffer = new NotificationBuffer();
    const decision = writeTransaction(this.db, (tx) =>
      requestStopInTransaction(tx, threadId, buffer),
    );
    buffer.flushTo(this.notifier);
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
    const buffer = new NotificationBuffer();
    const claimed = writeTransaction(this.db, (tx) =>
      projectLifecycleInTransaction(
        tx,
        { drain: true, event: { turnId, type: "stop.settled" }, threadId },
        buffer,
      ),
    );
    buffer.flushTo(this.notifier);
    if (claimed !== null) {
      this.dispatchQueuedMessage(threadId, claimed);
    }
  }

  send(request: SendMessageRequest): SendOutcome {
    const buffer = new NotificationBuffer();
    const decision = writeTransaction(this.db, (tx) =>
      this.resolveSendInTransaction(tx, request, buffer),
    );
    buffer.flushTo(this.notifier);
    switch (decision.kind) {
      case "dispatch": {
        return this.dispatchTurn(decision);
      }
      case "drain": {
        this.dispatchQueuedMessage(request.threadId, decision.claimed);
        return decision.outcome;
      }
      case "done": {
        return decision.outcome;
      }
      // no default
    }
  }

  private resolveSendInTransaction(
    tx: DbTransaction,
    request: SendMessageRequest,
    buffer: NotificationBuffer,
  ): SendDecision {
    const thread = getThread(tx, request.threadId);
    if (thread === null) {
      return { kind: "done", outcome: { kind: "not-found" } };
    }
    if (thread.archivedAt !== null) {
      return {
        kind: "done",
        outcome: { error: "archived", kind: "conflict", message: "The thread is archived" },
      };
    }
    if (request.expectedTurnId !== undefined && request.expectedTurnId !== thread.activeTurnId) {
      return {
        kind: "done",
        outcome: {
          error: "stale_turn",
          kind: "conflict",
          message: "The turn this message addressed is no longer the open one",
        },
      };
    }

    const turn = requestedTurn(request);
    switch (thread.status) {
      case "idle":
      case "error": {
        // a message left in line (a restart, a remote settle, a failed dispatch) goes
        // first: starting this one ahead of it would run the older one after an unrelated turn.
        const head = claimNextQueuedThreadMessageInTransaction(tx, thread.id);
        if (head === null) {
          return this.prepareTurnInTransaction(tx, thread, turn, buffer);
        }
        return {
          claimed: head,
          kind: "drain",
          outcome: queueInTransaction(tx, thread.id, turn, buffer),
        };
      }
      case "active":
      case "starting":
      case "stopping": {
        return { kind: "done", outcome: queueInTransaction(tx, thread.id, turn, buffer) };
      }
      // no default
    }
  }

  // takes the loaded row: the dispatch must carry what this transaction read, not what a second query could observe.
  private prepareTurnInTransaction(
    tx: DbTransaction,
    thread: ThreadRow,
    turn: TurnRequest,
    buffer: NotificationBuffer,
  ): SendDecision {
    const threadId = thread.id;
    const outcome = applyThreadLifecycleEventInTransaction(tx, {
      event: { type: "run.preparing" },
      threadId,
    });
    if (!outcome.applied) {
      // the drain's case: an archive landed between the settle and the claim.
      return {
        kind: "done",
        outcome: {
          error: "stale_turn",
          kind: "conflict",
          message: `Cannot start a turn: ${outcome.detail}`,
        },
      };
    }
    buffer.notifyThread(threadId, ["status-changed"]);
    const requested: Extract<ThreadEvent, { type: "client/turn/requested" }> = {
      scope: threadScope(),
      text: turn.text,
      threadId,
      type: "client/turn/requested",
    };
    if (turn.contextPaths !== undefined) {
      requested.contextPaths = [...turn.contextPaths];
    }
    if (turn.viewContext !== undefined) {
      requested.viewContext = turn.viewContext;
    }
    const firstRequest = !threadHasEvents(tx, threadId);
    this.appendLocal(tx, [requested]);
    buffer.notifyThread(threadId, ["events-appended"]);
    nameThreadFromRequestsInTransaction(tx, threadId, [requested], buffer);
    // after the naming, so the identity carries the title this request gave the thread.
    const named = firstRequest ? getThread(tx, threadId) : null;
    const identity = named === null ? null : threadIdentity(named);
    if (identity !== null) {
      this.appendLocal(tx, [identity]);
    }
    return {
      kind: "dispatch",
      threadId,
      turn,
      turnId: createTurnId(),
    };
  }

  private dispatchTurn(decision: Extract<SendDecision, { kind: "dispatch" }>): SendOutcome {
    try {
      this.driver.startTurn({
        ...decision.turn,
        threadId: decision.threadId,
        turnId: decision.turnId,
      });
    } catch (error) {
      this.recordDispatchFailure(decision.threadId, error);
      return error instanceof TurnDriverUnavailableError
        ? { kind: "provider-unavailable", message: error.message }
        : { kind: "dispatch-failed" };
    }
    return { kind: "started", turnId: decision.turnId };
  }

  private recordDispatchFailure(threadId: string, cause: unknown): void {
    this.failTurnlessRun(threadId, messageOf(cause));
  }

  // not routed through ingest: a thread-scoped provider/error projects no
  // lifecycle, so the thread would stay wedged in starting. the null turnId
  // match is what stops it killing a run that did start.
  private failTurnlessRun(threadId: string, message: string): void {
    const buffer = new NotificationBuffer();
    writeTransaction(this.db, (tx) => {
      this.appendLocal(tx, [{ message, scope: threadScope(), threadId, type: "provider/error" }]);
      buffer.notifyThread(threadId, ["events-appended"]);
      const outcome = applyThreadLifecycleEventInTransaction(tx, {
        event: { turnId: null, type: "run.failed" },
        threadId,
      });
      if (outcome.applied) {
        buffer.notifyThread(threadId, ["status-changed"]);
      }
    });
    buffer.flushTo(this.notifier);
  }

  timeline(query: TimelineQuery): TimelineResponse | null {
    if (getThread(this.db, query.threadId) === null) {
      return null;
    }
    const full = this.timelines.full(query.threadId);
    // a client ahead of the log (a rebuilt db) gets the full timeline.
    if (query.afterSequence === undefined || query.afterSequence > full.maxSequence) {
      return { kind: "full", timeline: full };
    }
    const base = this.timelines.prefix(query.threadId, query.afterSequence);
    return { delta: computeTimelineDelta(base, full), kind: "delta" };
  }

  answerInteraction(request: AnswerInteractionRequest): AnswerInteractionOutcome {
    const existing = getPendingInteraction(this.db, request.interactionId);
    if (existing === null || existing.threadId !== request.threadId) {
      return { kind: "not-found" };
    }
    const invalid = invalidResolutionMessage(existing.payload, request.resolution);
    if (invalid !== null) {
      return { kind: "invalid-resolution", message: invalid };
    }
    const outcome = resolvePendingInteraction(this.db, this.notifier, {
      id: request.interactionId,
      resolution: request.resolution,
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

  private ingest(
    args:
      | { origin: "local" | "recovery"; threadId: string; events: readonly ThreadEvent[] }
      | { origin: "remote"; threadId: string; rows: readonly SyncedEventInput[]; cursor: number },
  ): void {
    const { threadId } = args;
    const events = args.origin === "remote" ? args.rows.map((row) => row.event) : args.events;
    const mismatched = events.find((event) => event.threadId !== threadId);
    if (mismatched !== undefined) {
      throw new ThreadEventThreadIdMismatchError(threadId, mismatched.threadId);
    }
    if (events.length === 0) {
      return;
    }
    const buffer = new NotificationBuffer();
    const drains: ClaimedQueuedThreadMessageRow[] = [];
    const archived = writeTransaction(this.db, (tx) => {
      // lifecycle projects over the rows that landed, so a full replay after signing in again is a no-op rather than a status flap.
      let projected: readonly ThreadEvent[] = events;
      if (args.origin === "remote") {
        if (ensureThreadInTransaction(tx, threadId).created) {
          buffer.notifyThread(threadId, ["thread-created"]);
        }
        const landed = appendSyncedEventsInTransaction(tx, args.rows);
        projected = landed.applied.map((row) => row.event);
        // the cursor moves in this transaction: as a second write it leaves a
        // window a crash replays into duplicate rows. it advances even when
        // nothing landed — seen, not new.
        writeSyncCursor(tx, args.cursor);
        if (projected.length === 0) {
          return false;
        }
      } else {
        this.appendLocal(tx, events);
      }
      buffer.notifyThread(threadId, ["events-appended"]);
      // before the naming: a stated title outranks the one a first line would give.
      const archivedHere = projectThreadFactsInTransaction(tx, threadId, projected, buffer);
      nameThreadFromRequestsInTransaction(tx, threadId, projected, buffer);
      for (const event of projected) {
        const lifecycleEvent = lifecycleEventFor(event);
        if (lifecycleEvent === null) {
          continue;
        }
        // a recovery settle does not drain: a restart never starts a turn on its own, and the
        // next send takes the head.
        const claimed = projectLifecycleInTransaction(
          tx,
          { drain: args.origin === "local", event: lifecycleEvent, threadId },
          buffer,
        );
        if (claimed !== null) {
          drains.push(claimed);
        }
      }
      if (args.origin === "local" && projected.some((event) => event.type === "turn/started")) {
        this.stateHarnessInTransaction(tx, threadId);
      }
      return archivedHere;
    });
    buffer.flushTo(this.notifier);
    // archived on another device, it stops here as a local archive stops it; a turn that device
    // runs is its own to stop.
    if (archived) {
      this.stop(threadId);
    }
    for (const claimed of drains) {
      this.dispatchQueuedMessage(threadId, claimed);
    }
  }

  // the queue row and its request event are one transaction: deleting after
  // the dispatch left a window where a refused start released the row and the
  // next drain appended the message a second time, on every signed-in device.
  private dispatchQueuedMessage(threadId: string, claimed: ClaimedQueuedThreadMessageRow): void {
    const buffer = new NotificationBuffer();
    const decision = writeTransaction(this.db, (tx): SendDecision => {
      const thread = getThread(tx, threadId);
      if (thread === null) {
        return { kind: "done", outcome: { kind: "not-found" } };
      }
      const prepared = this.prepareTurnInTransaction(tx, thread, queuedTurn(claimed), buffer);
      if (prepared.kind === "dispatch") {
        deleteClaimedQueuedThreadMessageInTransaction(tx, claimed);
        buffer.notifyThread(threadId, ["queue-changed"]);
      }
      return prepared;
    });
    buffer.flushTo(this.notifier);
    if (decision.kind !== "dispatch") {
      // prepare appended nothing (archived between settle and drain): release, never consume.
      releaseQueuedMessageClaim(this.db, this.notifier, claimed);
      return;
    }
    this.dispatchTurn(decision);
  }

  // only the process that owns a provider may declare it dead: a synced thread
  // can be active because another device's turn is running, so the turn/started
  // row is asked who wrote it. a recovered turn gets turn/completed too —
  // provider/error alone projects no lifecycle, and the turn row would render
  // "working" forever.
  private recoverWedgedThreads(): void {
    const message = "The server restarted while this turn was running";
    for (const thread of listRunningThreads(this.db)) {
      const { activeTurnId } = thread;
      if (
        activeTurnId !== null &&
        turnStartOriginDeviceId(this.db, {
          threadId: thread.id,
          turnId: activeTurnId,
        }) !== null
      ) {
        continue;
      }
      if (activeTurnId === null) {
        // a crash between run.preparing and run.started: no turn to complete, so the failure names none.
        this.failTurnlessRun(thread.id, message);
      } else {
        this.ingest({
          events: [
            { message, scope: threadScope(), threadId: thread.id, type: "provider/error" },
            {
              scope: turnScope(activeTurnId),
              status: "failed",
              threadId: thread.id,
              type: "turn/completed",
            },
          ],
          origin: "recovery",
          threadId: thread.id,
        });
      }
      // the provider requests behind these rows died with the old process; a restarted provider raises fresh rows.
      interruptOpenPendingInteractions(this.db, this.notifier, thread.id);
    }
  }
}
