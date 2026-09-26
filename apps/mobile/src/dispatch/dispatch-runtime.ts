// the phone asks a Mac's agent through the dispatch inbox, as it produces captures: it never
// pushes to the thread log and never claims. A request is durable before it is sent and carries an
// id minted here, so a resend after a lost answer is the same row; while one waits and the app is
// in the foreground its fate is polled, and it is handed to the log once a pulled request carries
// its id. A phone-started turn's approvals are listed here and answered through the same inbox.

import { describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudClient, CloudFailure } from "@repo/api/cloud/client";
import {
  createDispatchRequestSchema,
  DISPATCH_MAX_CHARS,
  DISPATCH_MAX_PENDING,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import type {
  ApprovalRow,
  CreateDispatchRequest,
  DispatchStatus,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import { createSingleFlight } from "@repo/api/cloud/sync/sync-session";
import type { SyncOutcome } from "@repo/api/cloud/sync/sync-session";
import { answerableDecisions } from "@repo/domain/pending-interactions";
import type { PendingInteractionApprovalDecision } from "@repo/domain/pending-interactions";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import { createSerialLock } from "../lib/sql-driver";
import type { SqlDriver } from "../lib/sql-driver";
import type { SignInSource } from "../notes/notes-store";
import type { Fence } from "../notes/vault-mirror";
import type { SessionPort } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
import { projectThread } from "../sync/thread-projection";
import { createDispatchOutbox } from "./dispatch-outbox";
import type { DispatchRow } from "./dispatch-outbox";

export const DISPATCH_STATUS_POLL_MS = 10_000;

const NOT_SIGNED_IN = "Not signed in.";
// the cloud no longer holds a row it took: cancelled, pruned, or its phone revoked
const NO_LONGER_WAITING = "This request is no longer waiting for your Mac.";
const APPROVAL_GONE = "That request is no longer waiting for an answer.";

// where a request stands: `unsent` has not reached the cloud yet and says why the last try did not;
// `claimed` and `delivered` are a Mac holding it before its request reaches this phone's log
export type DispatchPhase =
  | { kind: "unsent"; error: string | null }
  | { kind: "waiting" }
  | { kind: "claimed" }
  | { kind: "delivered" }
  | { kind: "refused"; message: string };

interface DispatchViewBase {
  id: string;
  threadId: string;
  createdAt: number;
  phase: DispatchPhase;
}

export interface TurnDispatch extends DispatchViewBase {
  kind: "turn";
  text: string;
}

export interface AnswerDispatch extends DispatchViewBase {
  kind: "answer";
  approvalId: string;
  decision: PendingInteractionApprovalDecision;
}

export type DispatchView = TurnDispatch | AnswerDispatch;

export interface DispatchState {
  // oldest first
  dispatches: readonly DispatchView[];
  // a phone-started turn's questions its Mac is waiting on
  approvals: readonly ApprovalRow[];
  // Macs listening at the last status poll; null before one answered
  desktopsOnline: number | null;
}

const EMPTY_STATE: DispatchState = { approvals: [], desktopsOnline: null, dispatches: [] };

export interface AskAgentRequest {
  threadId: string;
  text: string;
  // the note a new thread is attached to, and the sha-256 of its bytes the phone showed
  note?: { path: string; revision?: string };
}

export type DispatchOutcome = { ok: true; id: string } | { ok: false; message: string };

export type CancelOutcome = { ok: true } | { ok: false; message: string };

export interface DispatchRuntimeArgs {
  db: SqlDriver;
  session: SessionPort;
  threads: Pick<SyncStore, "snapshotThread" | "snapshotThreads" | "subscribeThreads">;
  // a delivered request, and a running turn's reply, arrive through the log
  pull: () => void;
  // 16 random bytes as hex: the contract's dispatch id
  mintId: () => string;
  // null never polls on a timer
  pollIntervalMs?: number | null;
  onDebug?: (message: string) => void;
}

export interface DispatchRuntime extends ReadableStore<DispatchState> {
  // null is no sign-in, or one the cloud refused, and wipes the rows like a new sign-in does; only
  // a restore keeps them, so a request asked offline is sent after a relaunch
  reset: (next: SignInSource | null) => void;
  // the app is in the foreground again: send what waits, and poll while anything does
  resume: () => void;
  // the app left the foreground: nothing polls until it is back
  suspend: () => void;
  // one pass: resend, poll, list approvals. a call while one runs joins it
  sendNow: () => Promise<void>;
  newThreadId: () => string;
  askAgent: (request: AskAgentRequest) => Promise<DispatchOutcome>;
  answer: (
    approvalId: string,
    decision: PendingInteractionApprovalDecision,
  ) => Promise<DispatchOutcome>;
  // withdraws a request no Mac holds yet; a Mac that already has it keeps it
  cancel: (id: string) => Promise<CancelOutcome>;
  // forgets a refused request, whose words the phone kept until now
  dismiss: (id: string) => Promise<void>;
}

const phaseOf = (status: DispatchStatus | null, error: string | null): DispatchPhase => {
  if (status === null) {
    return { error, kind: "unsent" };
  }
  switch (status.state) {
    case "waiting":
    case "claimed":
    case "delivered": {
      return { kind: status.state };
    }
    case "refused": {
      return { kind: "refused", message: status.message };
    }
    case "unknown": {
      return { kind: "refused", message: NO_LONGER_WAITING };
    }
    // no default
  }
};

const viewOf = (row: DispatchRow, error: string | null): DispatchView => {
  const base: DispatchViewBase = {
    createdAt: row.createdAt,
    id: row.request.id,
    phase: phaseOf(row.status, error),
    threadId: row.threadId,
  };
  const { request } = row;
  return request.kind === "turn"
    ? { ...base, kind: "turn", text: request.text }
    : { ...base, approvalId: request.approvalId, decision: request.decision, kind: "answer" };
};

// a refused request stays until the user dismisses it; every other one is still moving
const settled = (row: DispatchRow): boolean => phaseOf(row.status, null).kind === "refused";

const polled = (row: DispatchRow): boolean =>
  row.status?.state === "waiting" || row.status?.state === "claimed";

const sameStatus = (a: DispatchStatus, b: DispatchStatus): boolean =>
  a.state === b.state &&
  (a.state !== "refused" || (b.state === "refused" && a.message === b.message));

// a refusal no resend passes: the request stays, refused, with the cloud's reason. A throttle, an
// unreadable answer or an unreachable cloud is tried again.
const finalRefusal = (failure: CloudFailure): string | null =>
  failure.kind === "refused" && failure.code !== "rate-limited" && failure.code !== "internal"
    ? failure.message
    : null;

const storageMessage = (detail: string): string =>
  `This phone could not keep your request: ${detail}`;

type StepOutcome = "done" | "stop" | "fenced";

export const createDispatchRuntime = (args: DispatchRuntimeArgs): DispatchRuntime => {
  const { session, threads } = args;
  const outbox = createDispatchOutbox(args.db);
  const pollIntervalMs =
    args.pollIntervalMs === undefined ? DISPATCH_STATUS_POLL_MS : args.pollIntervalMs;
  const debug = (message: string): void => {
    args.onDebug?.(`dispatch: ${message}`);
  };

  let rows: DispatchRow[] = [];
  let approvals: readonly ApprovalRow[] = [];
  let desktopsOnline: number | null = null;
  // why an unsent row's last try did not reach the cloud; not kept across a relaunch
  const errors = new Map<string, string>();
  let generation = 0;
  let resetWork: Promise<void> = Promise.resolve();
  let active = true;
  let timer: ReturnType<typeof setInterval> | null = null;
  const flight = createSingleFlight();
  // a cancel waits out a pass: a resend landing after the cancel would bring the row back
  const serial = createSerialLock();
  const state = createExternalStore<DispatchState>(EMPTY_STATE);

  const fenceFor = (sessionId: number): Fence => {
    const started = generation;
    return () => session.fenced(sessionId) && generation === started;
  };

  const liveFence = (): Fence | null => {
    const current = session.current();
    return current.kind === "live" ? fenceFor(current.id) : null;
  };

  const inLog = (row: DispatchRow): boolean => {
    if (row.request.kind !== "turn") {
      return false;
    }
    const thread = threads.snapshotThread(row.threadId);
    return thread !== null && projectThread(thread).dispatchIds.has(row.request.id);
  };

  const anyRunning = (): boolean =>
    threads.snapshotThreads().some((thread) => projectThread(thread).running);

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const wantsPolling = (): boolean =>
    rows.some((row) => !settled(row)) || approvals.length > 0 || anyRunning();

  const publish = (): void => {
    state.set({
      approvals,
      desktopsOnline,
      dispatches: rows.map((row) => viewOf(row, errors.get(row.request.id) ?? null)),
    });
  };

  const forget = (ids: readonly string[]): void => {
    rows = rows.filter((row) => !ids.includes(row.request.id));
    for (const id of ids) {
      errors.delete(id);
    }
  };

  // a Mac taking an answer settles its approval, so the answer's row has nothing left to say
  const record = async (id: string, status: DispatchStatus, fence: Fence): Promise<boolean> => {
    const row = rows.find((candidate) => candidate.request.id === id);
    if (row === undefined) {
      return true;
    }
    errors.delete(id);
    const { request } = row;
    if (request.kind === "answer" && status.state === "delivered") {
      if (!(await outbox.remove([id], fence))) {
        return false;
      }
      forget([id]);
      approvals = approvals.filter((approval) => approval.id !== request.approvalId);
      publish();
      return true;
    }
    if (row.status !== null && sameStatus(row.status, status)) {
      return true;
    }
    if (!(await outbox.setStatus(id, status, fence))) {
      return false;
    }
    rows = rows.map((candidate) =>
      candidate.request.id === id ? { ...candidate, status } : candidate,
    );
    publish();
    return true;
  };

  const sendUnsent = async (client: CloudClient, fence: Fence): Promise<StepOutcome> => {
    for (const row of rows.filter((candidate) => candidate.status === null)) {
      const { id } = row.request;
      const result = await client.createDispatch(row.request);
      if (!fence()) {
        return "fenced";
      }
      if (result.ok) {
        if (!(await record(id, result.value.dispatch, fence))) {
          return "fenced";
        }
        continue;
      }
      if (session.recordFailure(result.failure) === "ended") {
        return "fenced";
      }
      const refusal = finalRefusal(result.failure);
      if (refusal !== null) {
        if (!(await record(id, { id, message: refusal, state: "refused" }, fence))) {
          return "fenced";
        }
        continue;
      }
      // the cloud cannot take one now, so the rest wait for the next pass
      errors.set(id, describeCloudFailure(result.failure));
      publish();
      return "stop";
    }
    return "done";
  };

  const pollStatus = async (client: CloudClient, fence: Fence): Promise<StepOutcome> => {
    const ids = rows.filter(polled).map((row) => row.request.id);
    for (let start = 0; start < ids.length; start += DISPATCH_MAX_PENDING) {
      const result = await client.dispatchStatus(ids.slice(start, start + DISPATCH_MAX_PENDING));
      if (!fence()) {
        return "fenced";
      }
      if (!result.ok) {
        return session.recordFailure(result.failure) === "ended" ? "fenced" : "stop";
      }
      ({ desktopsOnline } = result.value);
      publish();
      for (const status of result.value.dispatches) {
        if (!(await record(status.id, status, fence))) {
          return "fenced";
        }
      }
    }
    return "done";
  };

  const pollApprovals = async (client: CloudClient, fence: Fence): Promise<StepOutcome> => {
    const result = await client.listApprovals();
    if (!fence()) {
      return "fenced";
    }
    if (!result.ok) {
      return session.recordFailure(result.failure) === "ended" ? "fenced" : "stop";
    }
    ({ approvals } = result.value);
    // a refused answer to a question no longer asked has nothing to show
    const listed = new Set(approvals.map((approval) => approval.id));
    const orphans = rows
      .filter(
        (row) =>
          row.request.kind === "answer" && settled(row) && !listed.has(row.request.approvalId),
      )
      .map((row) => row.request.id);
    if (orphans.length > 0) {
      if (!(await outbox.remove(orphans, fence))) {
        return "fenced";
      }
      forget(orphans);
    }
    publish();
    return "done";
  };

  // a request the log now holds is drawn from there alone
  const dropLanded = async (fence: Fence): Promise<void> => {
    const ids = rows.filter(inLog).map((row) => row.request.id);
    if (ids.length > 0 && (await outbox.remove(ids, fence))) {
      forget(ids);
      publish();
    }
  };

  const pass = async (): Promise<SyncOutcome> =>
    await serial(async () => {
      await resetWork;
      const current = session.current();
      if (current.kind !== "live") {
        return "fenced";
      }
      const fence = fenceFor(current.id);
      let outcome: SyncOutcome = "caught-up";
      for (const step of [sendUnsent, pollStatus, pollApprovals]) {
        const stepped = await step(current.client, fence);
        if (stepped === "fenced") {
          return "fenced";
        }
        if (stepped === "stop") {
          outcome = "failed";
          break;
        }
      }
      await dropLanded(fence);
      if (!fence()) {
        return "fenced";
      }
      const awaitingLog = rows.some(
        (row) => row.request.kind === "turn" && row.status?.state === "delivered",
      );
      if (awaitingLog || anyRunning()) {
        args.pull();
      }
      return outcome;
    });

  const runPasses = async (): Promise<void> => {
    if (session.current().kind !== "live") {
      return;
    }
    await flight.run({
      onError: (message) => {
        debug(`pass failed: ${message}`);
      },
      pass,
      repeat: () => session.current().kind === "live",
    });
  };

  // the timer runs only while something moves, so an idle phone in the foreground asks nothing
  const rearm = (): void => {
    if (
      !active ||
      pollIntervalMs === null ||
      session.current().kind !== "live" ||
      !wantsPolling()
    ) {
      clearTimer();
      return;
    }
    if (timer !== null) {
      return;
    }
    timer = setInterval(() => {
      void (async () => {
        await runPasses();
        rearm();
      })();
    }, pollIntervalMs);
    timer.unref?.();
  };

  const sendNow = async (): Promise<void> => {
    await runPasses();
    rearm();
  };

  // parsed although typed: the wire holds a note's path to the vault grammar and a revision to a
  // sha-256, and a request the cloud would refuse is better refused before it is kept
  const enqueue = async (
    threadId: string,
    candidate: CreateDispatchRequest,
  ): Promise<DispatchOutcome> => {
    const parsed = createDispatchRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        message: `This request could not be sent: ${parsed.error.issues[0]?.message ?? "it is malformed"}`,
        ok: false,
      };
    }
    await resetWork;
    const fence = liveFence();
    if (fence === null) {
      return { message: NOT_SIGNED_IN, ok: false };
    }
    const row: DispatchRow = {
      createdAt: Date.now(),
      request: parsed.data,
      status: null,
      threadId,
    };
    try {
      if (!(await outbox.add(row, fence))) {
        return { message: NOT_SIGNED_IN, ok: false };
      }
    } catch (error) {
      return {
        message: storageMessage(error instanceof Error ? error.message : String(error)),
        ok: false,
      };
    }
    rows = [...rows, row];
    publish();
    void sendNow();
    return { id: parsed.data.id, ok: true };
  };

  const cancelOne = async (id: string): Promise<CancelOutcome> => {
    await resetWork;
    const current = session.current();
    if (!rows.some((row) => row.request.id === id)) {
      return { ok: true };
    }
    if (current.kind !== "live") {
      return { message: NOT_SIGNED_IN, ok: false };
    }
    const fence = fenceFor(current.id);
    const result = await current.client.cancelDispatch(id);
    if (!fence()) {
      return { message: NOT_SIGNED_IN, ok: false };
    }
    if (!result.ok) {
      session.recordFailure(result.failure);
      return { message: describeCloudFailure(result.failure), ok: false };
    }
    switch (result.value.outcome) {
      // unknown: an unsent row never reached the cloud, and a sent one is gone from it
      case "cancelled":
      case "unknown": {
        if (await outbox.remove([id], fence)) {
          forget([id]);
          publish();
        }
        return { ok: true };
      }
      case "claimed": {
        await record(id, { id, state: "claimed" }, fence);
        return { ok: true };
      }
      case "settled": {
        const polledStatus = await current.client.dispatchStatus([id]);
        const [status] = polledStatus.ok ? polledStatus.value.dispatches : [];
        if (fence() && status !== undefined) {
          await record(id, status, fence);
        }
        return { ok: true };
      }
      // no default
    }
  };

  const hydrate = async (sessionId: number): Promise<void> => {
    const fence = fenceFor(sessionId);
    try {
      const loaded = await outbox.load();
      if (fence()) {
        rows = loaded;
        publish();
        rearm();
      }
    } catch (error) {
      debug(
        `the requests the last launch left could not be read: ${storageMessage(error instanceof Error ? error.message : String(error))}`,
      );
    }
  };

  const wipe = async (): Promise<void> => {
    try {
      await outbox.wipe();
    } catch {
      // a later sign-in wipes again, and a row is only sent under a live session
    }
  };

  threads.subscribeThreads(() => {
    const fence = liveFence();
    if (fence !== null) {
      void (async () => {
        await resetWork;
        try {
          await dropLanded(fence);
        } catch (error) {
          debug(
            `a request the log holds could not be dropped: ${storageMessage(error instanceof Error ? error.message : String(error))}`,
          );
        }
      })();
    }
    rearm();
  });

  return {
    answer: async (approvalId, decision) => {
      const approval = approvals.find((candidate) => candidate.id === approvalId);
      if (approval === undefined || approval.state !== "open") {
        return { message: APPROVAL_GONE, ok: false };
      }
      if (!answerableDecisions(approval.payload).includes(decision)) {
        return { message: "That answer is not one this request offers.", ok: false };
      }
      const request: CreateDispatchRequest = {
        approvalId,
        decision,
        id: args.mintId(),
        kind: "answer",
      };
      return await enqueue(approval.threadId, request);
    },

    askAgent: async (ask) => {
      const text = ask.text.trim();
      if (text === "") {
        return { message: "Write something to ask.", ok: false };
      }
      if (text.length > DISPATCH_MAX_CHARS) {
        return {
          message: `A message from your phone can be up to ${DISPATCH_MAX_CHARS.toLocaleString()} characters.`,
          ok: false,
        };
      }
      const request: Extract<CreateDispatchRequest, { kind: "turn" }> = {
        id: args.mintId(),
        kind: "turn",
        text,
        threadId: ask.threadId,
      };
      if (ask.note !== undefined) {
        request.originDocPath = ask.note.path;
        if (ask.note.revision !== undefined) {
          request.viewContext = {
            resource: ask.note.path,
            revision: ask.note.revision,
            surface: "doc",
          };
        }
      }
      return await enqueue(ask.threadId, request);
    },

    cancel: async (id) => {
      try {
        return await serial(async () => await cancelOne(id));
      } catch (error) {
        return {
          message: storageMessage(error instanceof Error ? error.message : String(error)),
          ok: false,
        };
      } finally {
        rearm();
      }
    },

    dismiss: async (id) => {
      await resetWork;
      const fence = liveFence();
      const row = rows.find((candidate) => candidate.request.id === id);
      if (fence === null || row === undefined || !settled(row)) {
        return;
      }
      try {
        if (await outbox.remove([id], fence)) {
          forget([id]);
          publish();
        }
      } catch (error) {
        debug(
          `a refused request could not be dismissed: ${storageMessage(error instanceof Error ? error.message : String(error))}`,
        );
      }
    },

    get: state.get,

    newThreadId: () => `thr_${args.mintId()}`,

    reset(next) {
      generation += 1;
      rows = [];
      approvals = [];
      desktopsOnline = null;
      errors.clear();
      clearTimer();
      publish();
      if (next !== "restored") {
        resetWork = wipe();
        return;
      }
      const current = session.current();
      resetWork = current.kind === "live" ? hydrate(current.id) : Promise.resolve();
    },

    resume() {
      active = true;
      void sendNow();
    },

    sendNow,

    subscribe: state.subscribe,

    suspend() {
      active = false;
      clearTimer();
    },
  };
};
