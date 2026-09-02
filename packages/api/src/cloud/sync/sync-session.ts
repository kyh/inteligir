// The client-side sync machinery every platform runs the same way: the
// session union and its fence, the single-flight pass, and the pull-page
// loop. The CLI and the phone both run it, and the fence discipline is
// security-bearing (a page applied after a re-pair writes another account's
// events into this one), so it has ONE spelling — two would be two to audit.
//
// What stays platform code is everything that touches a store: applying a
// plan, reading and moving the cursor, the outbox, timers and sockets.

import type { CloudClient, CloudFailure } from "../cloud-client";
import { SYNC_TERMINAL_CODES } from "../cloud-errors";
import { planPage, type LogPlanStep } from "./plan-page";
import { PULL_DEFAULT_LIMIT } from "./sync-schema";

/**
 * `id` is the fence. Every session gets a fresh one, and a pass captures the
 * id it started under and re-checks it after EVERY await — because "is a
 * session live?" is the wrong question when the answer can be yes about a
 * DIFFERENT session. Two ways that bites, both of them writes into the wrong
 * account: an in-flight push whose ack deletes the outbox rows a re-pairing
 * has since queued, and an in-flight pull whose page applies into the new
 * pairing and drags the cursor past rows it never saw.
 */
export type SyncSession<TCredential> =
  | { kind: "off"; id: number }
  | { kind: "live"; id: number; credential: TCredential; client: CloudClient }
  | { kind: "unauthorized"; id: number; credential: TCredential; detail: string };

export interface SyncSessionArgs<TCredential> {
  /** How the authed client is built for a credential. The signal is the
   *  session's own — aborted whenever the session ends, so a request
   *  belonging to it stops being paid for the moment it stops mattering. */
  makeClient(credential: TCredential, signal: AbortSignal): CloudClient;
  /** A terminal refusal just ended the session: close whatever keeps it alive
   *  (socket, timers) and publish. Only ever a refused failure — the codes
   *  are what make a refusal terminal. */
  onEnded?(failure: Extract<CloudFailure, { kind: "refused" }>): void;
}

export interface SyncSessionHandle<TCredential> {
  current(): SyncSession<TCredential>;
  /** End the current session and start a live one on `credential`. */
  open(credential: TCredential): void;
  /** End the current session; the machine goes `off`. */
  close(): void;
  /** Cancel in-flight work with no transition — a disposing runtime's half:
   *  the pass must observe cancellation, not be waited out. */
  abort(): void;
  /** True while `sessionId` is still the session this machine is running.
   *  Checked after EVERY await, immediately before any write. */
  fenced(sessionId: number): boolean;
  /** Swap the live session's credential in place (a fact about the same
   *  pairing was learned, e.g. the account id) — the id and client stand,
   *  because the session did not change, only what is known about it. A
   *  stale `sessionId` swaps nothing. */
  replaceCredential(sessionId: number, credential: TCredential): void;
  /** Whether `failure` ends this device's session. `ended` performs the
   *  unauthorized transition and calls `onEnded`; the caller stops. */
  recordFailure(failure: CloudFailure): "continue" | "ended";
}

export function createSyncSession<TCredential>(
  args: SyncSessionArgs<TCredential>,
): SyncSessionHandle<TCredential> {
  let counter = 0;
  let session: SyncSession<TCredential> = { kind: "off", id: 0 };
  /** Aborted whenever the session ends — a pair, an unpair, a refused
   *  credential — and rotated so the next session starts un-aborted. */
  let sessionAbort = new AbortController();

  function rotate(): void {
    sessionAbort.abort();
    sessionAbort = new AbortController();
  }

  /** live → unauthorized, keeping the credential so a surface can name the
   *  device the account refused. Always cancels in-flight work. Reached only
   *  through `recordFailure`: the terminal-code check and `onEnded` are what
   *  keep a session's end and its transport's teardown one event. */
  function endUnauthorized(detail: string): void {
    if (session.kind === "live") {
      counter += 1;
      session = { kind: "unauthorized", id: counter, credential: session.credential, detail };
    }
    rotate();
  }

  return {
    current: () => session,

    open(credential) {
      rotate();
      counter += 1;
      session = {
        kind: "live",
        id: counter,
        credential,
        client: args.makeClient(credential, sessionAbort.signal),
      };
    },

    close() {
      rotate();
      counter += 1;
      session = { kind: "off", id: counter };
    },

    abort() {
      sessionAbort.abort();
    },

    fenced: (sessionId) => session.kind === "live" && session.id === sessionId,

    replaceCredential(sessionId, credential) {
      if (session.kind !== "live" || session.id !== sessionId) return;
      session = { kind: "live", id: sessionId, credential, client: session.client };
    },

    recordFailure(failure) {
      if (failure.kind !== "refused" || !SYNC_TERMINAL_CODES.has(failure.code)) {
        return "continue";
      }
      endUnauthorized(failure.message);
      args.onEnded?.(failure);
      return "ended";
    },
  };
}

/** Bound on one pass's pull, so a backlog cannot hold a teardown open. What
 *  is left rides the next pass. */
export const MAX_PULL_PAGES_PER_PASS = 25;

export interface PullPagesArgs {
  /** The pass's OWN client, captured at the top — never re-read. */
  client: Pick<CloudClient, "pull">;
  deviceId: string;
  /** The session fence, re-checked before the request and again before the
   *  apply — a page that arrived under a session that has since ended must
   *  not be written (it may belong to another account). */
  fenced(): boolean;
  readCursor(): number;
  /** Execute one page's plan against this platform's store. */
  applyPlan(steps: readonly LogPlanStep[]): void;
  /** The session's verdict on a failed pull. */
  recordFailure(failure: CloudFailure): "continue" | "ended";
  /** After each applied page — where a runtime clears its error and
   *  publishes. */
  onPage?(): void;
  /** A row this build could not read, reported rather than dropped silently. */
  onSkipped?(message: string): void;
}

/** Page the log forward and apply everything this device did not write.
 *  Returns false when the session ended. */
export async function pullPages(args: PullPagesArgs): Promise<boolean> {
  for (let page = 0; page < MAX_PULL_PAGES_PER_PASS; page += 1) {
    if (!args.fenced()) return false;
    const result = await args.client.pull({
      afterSeq: args.readCursor(),
      limit: PULL_DEFAULT_LIMIT,
    });
    if (!args.fenced()) return false;
    if (!result.ok) return args.recordFailure(result.failure) === "continue";
    const plan = planPage(result.value.events, args.deviceId);
    for (const message of plan.skipped) args.onSkipped?.(message);
    args.applyPlan(plan.steps);
    args.onPage?.();
    if (!result.value.hasMore) return true;
  }
  return true;
}

export interface SingleFlightRunArgs {
  pass(): Promise<void>;
  /** Read after a dirty pass settles: run once more? (The session may have
   *  ended while it ran, which is the whole reason this is re-read.) */
  repeat(): boolean;
  /** A pass that threw, as one printable message — the runtime records and
   *  logs it; the loop must not die with it. */
  onError(message: string): void;
}

export interface SingleFlight {
  run(args: SingleFlightRunArgs): Promise<void>;
  /** The pass in flight, for a teardown that must let it settle — it owns a
   *  transaction and a request, and letting it finish is what keeps an ack
   *  and its push in agreement. */
  inflight(): Promise<void> | null;
}

/**
 * A pass is SINGLE-FLIGHT AND COALESCING: a trigger that lands mid-pass marks
 * the pass dirty rather than starting a second one — two concurrent drains
 * would push the same batch twice, and two concurrent pulls would apply the
 * same page twice. One more pass after the current one covers whatever
 * arrived while it ran.
 */
export function createSingleFlight(): SingleFlight {
  let inflight: Promise<void> | null = null;
  let dirty = false;
  return {
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
            // Read AFTER the await: everything can have moved while the pass
            // ran, which is the whole reason the loop exists.
            if (!dirty || !args.repeat()) break;
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
}
