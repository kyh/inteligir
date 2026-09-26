// one spelling for the cli and the phone: the fence is security-bearing (a page applied after
// signing in again writes another account's events into this one).

import type { CloudClient, CloudFailure } from "../cloud-client";
import { SYNC_TERMINAL_CODES } from "../cloud-errors";
import { planPage } from "./plan-page";
import type { LogPlan, LogPlanStep } from "./plan-page";
import { PULL_DEFAULT_LIMIT } from "./sync-schema";

// `id` is the fence: a pass captures the id it started under and re-checks it after every await,
// because "is a session live?" can be yes about a different session — an old push's ack deletes
// rows a new sign-in queued, and an old pull's page applies into the new session.
export type SyncSession<TCredential> =
  | { kind: "off"; id: number }
  | { kind: "live"; id: number; credential: TCredential; client: CloudClient }
  | { kind: "unauthorized"; id: number; credential: TCredential; detail: string };

export interface SyncSessionArgs<TCredential> {
  makeClient: (credential: TCredential, signal: AbortSignal) => CloudClient;
  onEnded?: (failure: Extract<CloudFailure, { kind: "refused" }>) => void;
  // a fence refusal is otherwise silent: the step just stops. absent costs one read per check.
  debugLog?: ((line: string) => void) | undefined;
}

export interface SyncSessionHandle<TCredential> {
  current: () => SyncSession<TCredential>;
  open: (credential: TCredential) => void;
  close: () => void;
  // no transition: a disposing runtime's pass must observe cancellation, not be waited out.
  abort: () => void;
  fenced: (sessionId: number) => boolean;
  // the id and client stand: only what is known about the same sign-in changed.
  replaceCredential: (sessionId: number, credential: TCredential) => void;
  recordFailure: (failure: CloudFailure) => "continue" | "ended";
}

export const createSyncSession = <TCredential>(
  args: SyncSessionArgs<TCredential>,
): SyncSessionHandle<TCredential> => {
  let counter = 0;
  let session: SyncSession<TCredential> = { id: 0, kind: "off" };
  let sessionAbort = new AbortController();

  const rotate = (): void => {
    sessionAbort.abort();
    sessionAbort = new AbortController();
  };

  // only through recordFailure, so a session's end and its transport's teardown stay one event.
  const endUnauthorized = (detail: string): void => {
    if (session.kind === "live") {
      counter += 1;
      session = { credential: session.credential, detail, id: counter, kind: "unauthorized" };
    }
    rotate();
  };

  return {
    abort() {
      sessionAbort.abort();
    },

    close() {
      rotate();
      counter += 1;
      session = { id: counter, kind: "off" };
    },

    current: () => session,

    fenced: (sessionId) => {
      const holds = session.kind === "live" && session.id === sessionId;
      if (!holds) {
        args.debugLog?.(
          `session ${sessionId} fenced out: the session is now ${session.kind} ${session.id}`,
        );
      }
      return holds;
    },

    open(credential) {
      rotate();
      counter += 1;
      session = {
        client: args.makeClient(credential, sessionAbort.signal),
        credential,
        id: counter,
        kind: "live",
      };
    },

    recordFailure(failure) {
      if (failure.kind !== "refused" || !SYNC_TERMINAL_CODES.has(failure.code)) {
        return "continue";
      }
      endUnauthorized(failure.message);
      args.onEnded?.(failure);
      return "ended";
    },

    replaceCredential(sessionId, credential) {
      if (session.kind !== "live" || session.id !== sessionId) {
        return;
      }
      session = { client: session.client, credential, id: sessionId, kind: "live" };
    },
  };
};

// where one step of a pass stopped. only "caught-up" lets a pass report synced: "more" is a
// per-pass cap reached with work behind it, "failed" a retryable refusal or an unreachable cloud
// the pass carries on past, and "fenced" a session that ended under it, which stops the pass.
export type SyncOutcome = "caught-up" | "more" | "failed" | "fenced";

// bounds one pass's pull so a backlog cannot hold a teardown open.
export const MAX_PULL_PAGES_PER_PASS = 25;

export interface PullPagesArgs {
  // captured at the top of the pass, never re-read.
  client: Pick<CloudClient, "pull">;
  ownDeviceIds: ReadonlySet<string>;
  // re-checked before the request, before the apply and after it: a page that arrived under an
  // ended session may belong to another account.
  fenced: () => boolean;
  readCursor: () => number;
  // a store that writes asynchronously answers a promise, which the pass waits out before it reads
  // the cursor again
  applyPlan: (steps: readonly LogPlanStep[]) => Promise<void> | void;
  recordFailure: (failure: CloudFailure) => "continue" | "ended";
  onPage?: () => void;
  onSkipped?: (message: string) => void;
  debugLog?: ((line: string) => void) | undefined;
}

// counts and positions only: a row's event is the conversation itself.
const describePage = (afterSeq: number, plan: LogPlan, rows: number, hasMore: boolean): string => {
  const applies = plan.steps.flatMap((step) => (step.kind === "apply" ? [step] : []));
  const applied = applies.reduce((sum, step) => sum + step.rows.length, 0);
  const threads = new Set(applies.map((step) => step.threadId)).size;
  return `pulled ${rows} row(s) after ${afterSeq}: ${applied} to apply across ${threads} thread(s), ${rows - applied} skipped as this device's own or unreadable${hasMore ? ", more behind" : ""}`;
};

export const pullPages = async (args: PullPagesArgs): Promise<SyncOutcome> => {
  for (let page = 0; page < MAX_PULL_PAGES_PER_PASS; page += 1) {
    if (!args.fenced()) {
      return "fenced";
    }
    const afterSeq = args.readCursor();
    const result = await args.client.pull({ afterSeq, limit: PULL_DEFAULT_LIMIT });
    if (!args.fenced()) {
      return "fenced";
    }
    if (!result.ok) {
      return args.recordFailure(result.failure) === "continue" ? "failed" : "fenced";
    }
    const plan = planPage(result.value.events, args.ownDeviceIds);
    args.debugLog?.(describePage(afterSeq, plan, result.value.events.length, result.value.hasMore));
    for (const message of plan.skipped) {
      args.onSkipped?.(message);
    }
    await args.applyPlan(plan.steps);
    if (!args.fenced()) {
      return "fenced";
    }
    args.onPage?.();
    // an empty page moves no cursor, so asking again asks the same question: "more" must mean
    // progress, or a pass that follows itself at once would never stop.
    if (!result.value.hasMore || result.value.events.length === 0) {
      return "caught-up";
    }
  }
  return "more";
};

export interface SingleFlightRunArgs {
  // "more" runs the next pass at once rather than leaving the backlog to the poll. each pass
  // stays capped and repeat() is read between them, so a teardown still waits out at most one.
  pass: () => Promise<SyncOutcome>;
  repeat: () => boolean;
  onError: (message: string) => void;
}

export interface SingleFlight {
  run: (args: SingleFlightRunArgs) => Promise<void>;
  // a teardown lets it settle: it owns a transaction and a request, and finishing keeps an ack
  // and its push in agreement.
  inflight: () => Promise<void> | null;
}

// a trigger mid-pass marks it dirty rather than starting a second: two concurrent drains push
// the same batch twice, and two concurrent pulls apply the same page twice.
export const createSingleFlight = (): SingleFlight => {
  let inflight: Promise<void> | null = null;
  let dirty = false;
  return {
    // null is the signal a teardown reads; an async wrapper would hide it inside a promise.
    inflight: () => inflight,

    async run(args) {
      if (inflight !== null) {
        dirty = true;
        await inflight;
        return;
      }
      inflight = (async () => {
        try {
          for (;;) {
            dirty = false;
            const outcome = await args.pass();
            // read after the await: the session may have ended while the pass ran.
            if ((!dirty && outcome !== "more") || !args.repeat()) {
              break;
            }
          }
        } catch (error) {
          args.onError(error instanceof Error ? error.message : String(error));
        } finally {
          inflight = null;
        }
      })();
      await inflight;
    },
  };
};
