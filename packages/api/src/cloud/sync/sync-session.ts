// one spelling for the cli and the phone: the fence is security-bearing (a page applied after
// signing in again writes another account's events into this one).

import type { CloudClient, CloudFailure } from "../cloud-client";
import { SYNC_TERMINAL_CODES } from "../cloud-errors";
import { planPage } from "./plan-page";
import type { LogPlanStep } from "./plan-page";
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

    fenced: (sessionId) => session.kind === "live" && session.id === sessionId,

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

// bounds one pass's pull so a backlog cannot hold a teardown open.
export const MAX_PULL_PAGES_PER_PASS = 25;

export interface PullPagesArgs {
  // captured at the top of the pass, never re-read.
  client: Pick<CloudClient, "pull">;
  deviceId: string;
  // re-checked before the request and before the apply: a page that arrived under an ended
  // session may belong to another account.
  fenced: () => boolean;
  readCursor: () => number;
  applyPlan: (steps: readonly LogPlanStep[]) => void;
  recordFailure: (failure: CloudFailure) => "continue" | "ended";
  onPage?: () => void;
  onSkipped?: (message: string) => void;
}

export const pullPages = async (args: PullPagesArgs): Promise<boolean> => {
  for (let page = 0; page < MAX_PULL_PAGES_PER_PASS; page += 1) {
    if (!args.fenced()) {
      return false;
    }
    const result = await args.client.pull({
      afterSeq: args.readCursor(),
      limit: PULL_DEFAULT_LIMIT,
    });
    if (!args.fenced()) {
      return false;
    }
    if (!result.ok) {
      return args.recordFailure(result.failure) === "continue";
    }
    const plan = planPage(result.value.events, args.deviceId);
    for (const message of plan.skipped) {
      args.onSkipped?.(message);
    }
    args.applyPlan(plan.steps);
    args.onPage?.();
    if (!result.value.hasMore) {
      return true;
    }
  }
  return true;
};

export interface SingleFlightRunArgs {
  pass: () => Promise<void>;
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
    // oxlint-disable-next-line typescript/promise-function-async -- see above
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
            await args.pass();
            // read after the await: the session may have ended while the pass ran.
            if (!dirty || !args.repeat()) {
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
