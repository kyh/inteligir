// one spelling for the cli and the phone: the fence is security-bearing (an answer that lands after
// signing in again would write what another account's vault holds into this one).

import type { CloudClient, CloudFailure } from "../cloud-client";
import { SYNC_TERMINAL_CODES } from "../cloud-errors";

// `id` is the fence: a caller captures the id it started under and re-checks it after every
// await, because "is a session live?" can be yes about a different session — a mirror read that
// started under the old sign-in would land in the new one.
// `outdated` keeps a credential the cloud never refused: this build is below its floor, and the
// next build opens the same sign-in live again.
export type SyncSession<TCredential> =
  | { kind: "off"; id: number }
  | { kind: "live"; id: number; credential: TCredential; client: CloudClient }
  | { kind: "unauthorized"; id: number; credential: TCredential; detail: string }
  | { kind: "outdated"; id: number; credential: TCredential };

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
  // no transition: a disposing runtime's requests must observe cancellation, not be waited out.
  abort: () => void;
  fenced: (sessionId: number) => boolean;
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
  const end = (failure: Extract<CloudFailure, { kind: "refused" }>): void => {
    if (session.kind === "live") {
      counter += 1;
      const { credential } = session;
      session =
        failure.code === "client-outdated"
          ? { credential, id: counter, kind: "outdated" }
          : { credential, detail: failure.message, id: counter, kind: "unauthorized" };
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
      end(failure);
      args.onEnded?.(failure);
      return "ended";
    },
  };
};

// where one step of a pass stopped. only "caught-up" lets a pass report synced: "more" is a
// per-pass cap reached with work behind it, "failed" a retryable refusal or an unreachable cloud
// the pass carries on past, and "fenced" a session that ended under it, which stops the pass.
export type SyncOutcome = "caught-up" | "more" | "failed" | "fenced";

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

// what a check of the sign-in found. `fenced`: no live session, or one that ended while the check
// was out, whose answer speaks for a sign-in this device has left.
export type SignInCheck =
  | { kind: "live" }
  | { kind: "failed"; failure: CloudFailure }
  | { kind: "fenced" };

// the cheapest request that names the credential, one spelling for both clients: its refusal is
// the revocation a socket's close only hints at, and the caller records it as any other.
export const checkSignIn = async <TCredential>(
  session: Pick<SyncSessionHandle<TCredential>, "current" | "fenced">,
): Promise<SignInCheck> => {
  const current = session.current();
  if (current.kind !== "live") {
    return { kind: "fenced" };
  }
  const result = await current.client.listDevices();
  if (!session.fenced(current.id)) {
    return { kind: "fenced" };
  }
  return result.ok ? { kind: "live" } : { failure: result.failure, kind: "failed" };
};
