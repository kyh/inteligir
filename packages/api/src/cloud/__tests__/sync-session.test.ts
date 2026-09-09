import { describe, expect, it } from "vitest";
import type { CloudClient, CloudFailure, CloudResult } from "../cloud-client";
import type { LogPlanStep } from "../sync/plan-page";
import type { PullResponse, SyncEventRow } from "../sync/sync-schema";
import {
  createSingleFlight,
  createSyncSession,
  MAX_PULL_PAGES_PER_PASS,
  pullPages,
} from "../sync/sync-session";
import type { PullPagesArgs } from "../sync/sync-session";

const UNAUTHORIZED: CloudFailure = {
  code: "unauthorized",
  deviceSeq: null,
  kind: "refused",
  message: "credential revoked",
};

const RATE_LIMITED: CloudFailure = {
  code: "rate-limited",
  deviceSeq: null,
  kind: "refused",
  message: "slow down",
};

const ok = <T>(value: T): CloudResult<T> => ({ ok: true, value });

const noop = (): void => {};

const unreachable = async <T>(): Promise<CloudResult<T>> => ({
  failure: { kind: "unreachable", message: "fake" },
  ok: false,
});

const fakeClient = (pull: CloudClient["pull"]): CloudClient => ({
  account: async () => await unreachable(),
  ackCaptures: async () => await unreachable(),
  claimCaptures: async () => await unreachable(),
  createCapture: async () => await unreachable(),
  pull,
  push: async () => await unreachable(),
  vaultAssetSource: () => ({ headers: {}, uri: "https://cloud.test/fake" }),
  vaultFile: async () => await unreachable(),
  vaultTree: async () => await unreachable(),
});

interface Harness {
  session: ReturnType<typeof createSyncSession<{ deviceId: string }>>;
  signals: AbortSignal[];
  ended: CloudFailure[];
}

const harness = (): Harness => {
  const signals: AbortSignal[] = [];
  const ended: CloudFailure[] = [];
  const session = createSyncSession<{ deviceId: string }>({
    makeClient: (_credential, signal) => {
      signals.push(signal);
      return fakeClient(async () => await unreachable());
    },
    onEnded: (failure) => {
      ended.push(failure);
    },
  });
  return { ended, session, signals };
};

describe("the session union", () => {
  it("opens live with a fresh id, and every transition bumps it", () => {
    const { session } = harness();
    expect(session.current()).toEqual({ id: 0, kind: "off" });
    session.open({ deviceId: "dev_1" });
    const first = session.current();
    expect(first.kind).toBe("live");
    session.close();
    expect(session.current().kind).toBe("off");
    session.open({ deviceId: "dev_2" });
    const second = session.current();
    if (first.kind !== "live" || second.kind !== "live") {
      throw new Error("expected live");
    }
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
    if (live.kind !== "live") {
      throw new Error("expected live");
    }
    session.replaceCredential(live.id, { deviceId: "dev_1+identity" });
    const swapped = session.current();
    if (swapped.kind !== "live") {
      throw new Error("expected live");
    }
    expect(swapped.id).toBe(live.id);
    expect(swapped.client).toBe(live.client);
    expect(swapped.credential.deviceId).toBe("dev_1+identity");

    session.open({ deviceId: "dev_2" });
    session.replaceCredential(live.id, { deviceId: "stale" });
    const after = session.current();
    if (after.kind !== "live") {
      throw new Error("expected live");
    }
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
      credential: { deviceId: "dev_1" },
      detail: "credential revoked",
      kind: "unauthorized",
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

const row = (seq: number, deviceId: string): SyncEventRow => ({
  createdAt: 0,
  deviceId,
  deviceSeq: seq,
  // not a ThreadEvent: planPage answers a cursor-only skip step, all this loop needs
  event: { opaque: true },
  seq,
  threadId: "thr_1",
});

interface PageLoop {
  applied: LogPlanStep[][];
  skipped: string[];
  pages: number[];
  cursor: number;
}

const pageLoop = (args: {
  results: CloudResult<PullResponse>[];
  fenced?: () => boolean;
  recordFailure?: (failure: CloudFailure) => "continue" | "ended";
}) => {
  const loop: PageLoop = { applied: [], cursor: 0, pages: [], skipped: [] };
  const pullArgs: PullPagesArgs = {
    applyPlan: (steps) => {
      loop.applied.push([...steps]);
      for (const step of steps) {
        if (step.kind === "skip") {
          loop.cursor = step.cursor;
        }
      }
    },
    client: {
      pull: async (query) => {
        loop.pages.push(query.afterSeq);
        return args.results.shift() ?? ok({ events: [], hasMore: false, lastSeq: loop.cursor });
      },
    },
    deviceId: "dev_self",
    fenced: args.fenced ?? (() => true),
    onSkipped: (message) => {
      loop.skipped.push(message);
    },
    readCursor: () => loop.cursor,
    recordFailure: args.recordFailure ?? (() => "continue"),
  };
  const run = async () => await pullPages(pullArgs);
  return { loop, run };
};

describe("pullPages", () => {
  it("walks hasMore pages from the moving cursor and applies each plan", async () => {
    const { loop, run } = pageLoop({
      results: [
        ok({ events: [row(1, "dev_other")], hasMore: true, lastSeq: 1 }),
        ok({ events: [row(2, "dev_other")], hasMore: false, lastSeq: 2 }),
      ],
    });
    expect(await run()).toBe(true);
    expect(loop.pages).toEqual([0, 1]);
    expect(loop.applied).toHaveLength(2);
    expect(loop.cursor).toBe(2);
    expect(loop.skipped).toHaveLength(2);
  });

  it("stops at the page bound — what is left rides the next pass", async () => {
    const endless = ok({ events: [row(1, "dev_other")], hasMore: true, lastSeq: 1 });
    const { loop, run } = pageLoop({
      results: Array.from({ length: MAX_PULL_PAGES_PER_PASS + 5 }, () => endless),
    });
    expect(await run()).toBe(true);
    expect(loop.pages).toHaveLength(MAX_PULL_PAGES_PER_PASS);
  });

  it("answers the session's own verdict on a failed pull", async () => {
    const failed: CloudResult<PullResponse> = { failure: RATE_LIMITED, ok: false };
    const continuing = pageLoop({ recordFailure: () => "continue", results: [failed] });
    expect(await continuing.run()).toBe(true);
    const ending = pageLoop({ recordFailure: () => "ended", results: [failed] });
    expect(await ending.run()).toBe(false);
    expect(ending.loop.applied).toEqual([]);
  });

  it("THE FENCE: a page that lands after its session ended applies nothing", async () => {
    const { session } = harness();
    session.open({ deviceId: "dev_1" });
    const live = session.current();
    if (live.kind !== "live") {
      throw new Error("expected live");
    }
    const sessionId = live.id;

    let release: (result: CloudResult<PullResponse>) => void = noop;
    // oxlint-disable-next-line promise/avoid-new -- released later from outside; no async equivalent.
    const held = new Promise<CloudResult<PullResponse>>((resolve) => {
      release = resolve;
    });
    const applied: LogPlanStep[][] = [];
    const pass = pullPages({
      applyPlan: (steps) => {
        applied.push([...steps]);
      },
      client: { pull: async () => await held },
      deviceId: "dev_1",
      fenced: () => session.fenced(sessionId),
      readCursor: () => 0,
      recordFailure: session.recordFailure,
    });

    session.open({ deviceId: "dev_2" });
    release(ok({ events: [row(1, "dev_other")], hasMore: false, lastSeq: 1 }));

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
    const gates: Promise<void>[] = [
      // oxlint-disable-next-line promise/avoid-new -- released later from outside; no async equivalent.
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
    const runArgs = { onError: () => {}, pass, repeat: () => true };

    const first = flight.run(runArgs);
    const second = flight.run(runArgs);
    expect(flight.inflight()).not.toBeNull();
    release();
    await Promise.all([first, second]);

    expect(passes).toBe(2);
    expect(flight.inflight()).toBeNull();
  });

  it("does not repeat once repeat() says the session ended, and routes a throw to onError", async () => {
    const flight = createSingleFlight();
    let passes = 0;
    let release: () => void = noop;
    // oxlint-disable-next-line promise/avoid-new -- released later from outside; no async equivalent.
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const args = {
      onError: () => {},
      pass: async (): Promise<void> => {
        passes += 1;
        await held;
      },
      repeat: () => false,
    };
    const first = flight.run(args);
    const joined = flight.run(args);
    release();
    await Promise.all([first, joined]);
    expect(passes).toBe(1);

    const errors: string[] = [];
    await flight.run({
      onError: (message) => {
        errors.push(message);
      },
      pass: () => {
        throw new Error("boom");
      },
      repeat: () => true,
    });
    expect(errors).toEqual(["boom"]);
  });
});
