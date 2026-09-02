// The session machinery's own suite: the fence (a pass that started under
// session N writes nothing after N ends), the terminal-code→unauthorized
// transition, abort rotation, the page loop's bounds and the single-flight
// coalescing — pinned at the one implementation rather than once per
// platform.

import { describe, expect, it } from "vitest";
import type { CloudClient, CloudFailure, CloudResult } from "../cloud-client";
import type { LogPlanStep } from "../sync/plan-page";
import type { PullResponse, SyncEventRow } from "../sync/sync-schema";
import {
  createSingleFlight,
  createSyncSession,
  MAX_PULL_PAGES_PER_PASS,
  pullPages,
  type PullPagesArgs,
} from "../sync/sync-session";

const UNAUTHORIZED: CloudFailure = {
  kind: "refused",
  code: "unauthorized",
  message: "credential revoked",
  deviceSeq: null,
};

const RATE_LIMITED: CloudFailure = {
  kind: "refused",
  code: "rate-limited",
  message: "slow down",
  deviceSeq: null,
};

function ok<T>(value: T): CloudResult<T> {
  return { ok: true, value };
}

/** Only ever the placeholder a `new Promise` executor overwrites. */
function noop(): void {}

function unreachable<T>(): Promise<CloudResult<T>> {
  return Promise.resolve({ ok: false, failure: { kind: "unreachable", message: "fake" } });
}

/** A full client whose only live row is `pull`; the session machine never
 *  calls the rest. */
function fakeClient(pull: CloudClient["pull"]): CloudClient {
  return {
    pull,
    push: () => unreachable(),
    createCapture: () => unreachable(),
    claimCaptures: () => unreachable(),
    ackCaptures: () => unreachable(),
    account: () => unreachable(),
    vaultTree: () => unreachable(),
    vaultFile: () => unreachable(),
    vaultAssetSource: () => ({ uri: "https://cloud.test/fake", headers: {} }),
  };
}

interface Harness {
  session: ReturnType<typeof createSyncSession<{ deviceId: string }>>;
  signals: AbortSignal[];
  ended: CloudFailure[];
}

function harness(): Harness {
  const signals: AbortSignal[] = [];
  const ended: CloudFailure[] = [];
  const session = createSyncSession<{ deviceId: string }>({
    makeClient: (_credential, signal) => {
      signals.push(signal);
      return fakeClient(() => unreachable());
    },
    onEnded: (failure) => {
      ended.push(failure);
    },
  });
  return { session, signals, ended };
}

describe("the session union", () => {
  it("opens live with a fresh id, and every transition bumps it", () => {
    const { session } = harness();
    expect(session.current()).toEqual({ kind: "off", id: 0 });
    session.open({ deviceId: "dev_1" });
    const first = session.current();
    expect(first.kind).toBe("live");
    session.close();
    expect(session.current().kind).toBe("off");
    session.open({ deviceId: "dev_2" });
    const second = session.current();
    if (first.kind !== "live" || second.kind !== "live") throw new Error("expected live");
    expect(second.id).toBeGreaterThan(first.id);
    expect(session.fenced(first.id)).toBe(false);
    expect(session.fenced(second.id)).toBe(true);
  });

  it("rotates the abort on every end: the old session's requests die, the new one's live", () => {
    const { session, signals } = harness();
    session.open({ deviceId: "dev_1" });
    session.open({ deviceId: "dev_2" });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    session.close();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("abort() cancels in-flight work without a transition — dispose's half", () => {
    const { session, signals } = harness();
    session.open({ deviceId: "dev_1" });
    const live = session.current();
    session.abort();
    expect(signals[0]?.aborted).toBe(true);
    expect(session.current()).toBe(live);
  });

  it("replaces the live credential in place, and refuses a stale session id", () => {
    const { session } = harness();
    session.open({ deviceId: "dev_1" });
    const live = session.current();
    if (live.kind !== "live") throw new Error("expected live");
    session.replaceCredential(live.id, { deviceId: "dev_1+identity" });
    const swapped = session.current();
    if (swapped.kind !== "live") throw new Error("expected live");
    expect(swapped.id).toBe(live.id);
    expect(swapped.client).toBe(live.client);
    expect(swapped.credential.deviceId).toBe("dev_1+identity");

    session.open({ deviceId: "dev_2" });
    session.replaceCredential(live.id, { deviceId: "stale" });
    const after = session.current();
    if (after.kind !== "live") throw new Error("expected live");
    expect(after.credential.deviceId).toBe("dev_2");
  });
});

describe("recordFailure", () => {
  it("ends the session on a terminal code: unauthorized, aborted, onEnded once", () => {
    const { session, signals, ended } = harness();
    session.open({ deviceId: "dev_1" });
    expect(session.recordFailure(UNAUTHORIZED)).toBe("ended");
    const current = session.current();
    expect(current).toMatchObject({
      kind: "unauthorized",
      credential: { deviceId: "dev_1" },
      detail: "credential revoked",
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(ended).toEqual([UNAUTHORIZED]);
  });

  it("continues on everything else — a retryable refusal must not end the session", () => {
    const { session, ended } = harness();
    session.open({ deviceId: "dev_1" });
    expect(session.recordFailure(RATE_LIMITED)).toBe("continue");
    expect(session.recordFailure({ kind: "unreachable", message: "offline" })).toBe("continue");
    expect(session.current().kind).toBe("live");
    expect(ended).toEqual([]);
  });
});

function row(seq: number, deviceId: string): SyncEventRow {
  return {
    seq,
    threadId: "thr_1",
    deviceId,
    deviceSeq: seq,
    // Not a ThreadEvent this build understands — planPage turns it into a
    // cursor-only skip step plus a skipped message, which is all this loop's
    // own behaviour needs.
    event: { opaque: true },
    createdAt: 0,
  };
}

interface PageLoop {
  applied: LogPlanStep[][];
  skipped: string[];
  pages: number[];
  cursor: number;
}

function pageLoop(args: {
  results: Array<CloudResult<PullResponse>>;
  fenced?: () => boolean;
  recordFailure?: (failure: CloudFailure) => "continue" | "ended";
}) {
  const loop: PageLoop = { applied: [], skipped: [], pages: [], cursor: 0 };
  const pullArgs: PullPagesArgs = {
    client: {
      pull: (query) => {
        loop.pages.push(query.afterSeq);
        return Promise.resolve(
          args.results.shift() ?? ok({ events: [], lastSeq: loop.cursor, hasMore: false }),
        );
      },
    },
    deviceId: "dev_self",
    fenced: args.fenced ?? (() => true),
    readCursor: () => loop.cursor,
    applyPlan: (steps) => {
      loop.applied.push([...steps]);
      for (const step of steps) {
        if (step.kind === "skip") loop.cursor = step.cursor;
      }
    },
    recordFailure: args.recordFailure ?? (() => "continue"),
    onSkipped: (message) => loop.skipped.push(message),
  };
  const run = () => pullPages(pullArgs);
  return { loop, run };
}

describe("pullPages", () => {
  it("walks hasMore pages from the moving cursor and applies each plan", async () => {
    const { loop, run } = pageLoop({
      results: [
        ok({ events: [row(1, "dev_other")], lastSeq: 1, hasMore: true }),
        ok({ events: [row(2, "dev_other")], lastSeq: 2, hasMore: false }),
      ],
    });
    expect(await run()).toBe(true);
    expect(loop.pages).toEqual([0, 1]);
    expect(loop.applied).toHaveLength(2);
    expect(loop.cursor).toBe(2);
    expect(loop.skipped).toHaveLength(2);
  });

  it("stops at the page bound — what is left rides the next pass", async () => {
    const endless = ok({ events: [row(1, "dev_other")], lastSeq: 1, hasMore: true });
    const { loop, run } = pageLoop({
      results: Array.from({ length: MAX_PULL_PAGES_PER_PASS + 5 }, () => endless),
    });
    expect(await run()).toBe(true);
    expect(loop.pages).toHaveLength(MAX_PULL_PAGES_PER_PASS);
  });

  it("answers the session's own verdict on a failed pull", async () => {
    const failed: CloudResult<PullResponse> = { ok: false, failure: RATE_LIMITED };
    const continuing = pageLoop({ results: [failed], recordFailure: () => "continue" });
    expect(await continuing.run()).toBe(true);
    const ending = pageLoop({ results: [failed], recordFailure: () => "ended" });
    expect(await ending.run()).toBe(false);
    expect(ending.loop.applied).toEqual([]);
  });

  it("THE FENCE: a page that lands after its session ended applies nothing", async () => {
    const { session } = harness();
    session.open({ deviceId: "dev_1" });
    const live = session.current();
    if (live.kind !== "live") throw new Error("expected live");
    const sessionId = live.id;

    let release: (result: CloudResult<PullResponse>) => void = noop;
    const held = new Promise<CloudResult<PullResponse>>((resolve) => {
      release = resolve;
    });
    const applied: LogPlanStep[][] = [];
    const pass = pullPages({
      client: { pull: () => held },
      deviceId: "dev_1",
      fenced: () => session.fenced(sessionId),
      readCursor: () => 0,
      applyPlan: (steps) => {
        applied.push([...steps]);
      },
      recordFailure: session.recordFailure,
    });

    // The page ARRIVES after a re-pair. "Is a session live?" would answer yes
    // — about a different pairing — so only the identity check can refuse it.
    session.open({ deviceId: "dev_2" });
    release(ok({ events: [row(1, "dev_other")], lastSeq: 1, hasMore: false }));

    expect(await pass).toBe(false);
    expect(applied).toEqual([]);
  });
});

describe("createSingleFlight", () => {
  it("coalesces: a trigger mid-pass marks the pass dirty rather than starting a second one", async () => {
    const flight = createSingleFlight();
    let running = 0;
    let passes = 0;
    let release: () => void = noop;
    const gates: Array<Promise<void>> = [
      new Promise((resolve) => {
        release = resolve;
      }),
      Promise.resolve(),
    ];
    const pass = async (): Promise<void> => {
      running += 1;
      expect(running).toBe(1);
      passes += 1;
      await gates.shift();
      running -= 1;
    };
    const runArgs = { pass, repeat: () => true, onError: () => undefined };

    const first = flight.run(runArgs);
    const second = flight.run(runArgs);
    expect(flight.inflight()).not.toBeNull();
    release();
    await Promise.all([first, second]);

    // One more pass after the held one covers what arrived while it ran.
    expect(passes).toBe(2);
    expect(flight.inflight()).toBeNull();
  });

  it("does not repeat once repeat() says the session ended, and routes a throw to onError", async () => {
    const flight = createSingleFlight();
    let passes = 0;
    let release: () => void = noop;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const args = {
      pass: async (): Promise<void> => {
        passes += 1;
        await held;
      },
      repeat: () => false,
      onError: () => undefined,
    };
    const first = flight.run(args);
    const joined = flight.run(args);
    release();
    await Promise.all([first, joined]);
    expect(passes).toBe(1);

    const errors: string[] = [];
    await flight.run({
      pass: () => Promise.reject(new Error("boom")),
      repeat: () => true,
      onError: (message) => errors.push(message),
    });
    expect(errors).toEqual(["boom"]);
  });
});
