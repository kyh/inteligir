import { describe, expect, it } from "vitest";
import type { CloudFailure, CloudResult } from "../cloud-client";
import type { ListDevicesResponse } from "../device/device-schema";
import { checkSignIn, createSingleFlight, createSyncSession } from "./sync-session";
import type { SyncOutcome } from "./sync-session";
import { fakeCloudClient, ok } from "../test-support/fake-cloud-client";

const UNAUTHORIZED: CloudFailure = {
  code: "unauthorized",
  kind: "refused",
  message: "credential revoked",
};

const RATE_LIMITED: CloudFailure = {
  code: "rate-limited",
  kind: "refused",
  message: "slow down",
};

const noop = (): void => {};

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
      return fakeCloudClient();
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

// the listing's answer, released by the test once the session it was asked under has ended
interface HeldAnswer {
  answer: ((result: CloudResult<ListDevicesResponse>) => void) | null;
}

const answering = (answer: () => Promise<CloudResult<ListDevicesResponse>>) =>
  createSyncSession<{ deviceId: string }>({
    makeClient: () => fakeCloudClient({ listDevices: answer }),
  });

describe("checkSignIn", () => {
  it("asks nothing with no live session", async () => {
    let asked = 0;
    const session = answering(async () => {
      asked += 1;
      return await Promise.resolve(ok({ devices: [] }));
    });
    expect(await checkSignIn(session)).toEqual({ kind: "fenced" });
    expect(asked).toBe(0);
  });

  it("reads an answer as live and a refusal as the failure the caller records", async () => {
    const live = answering(async () => await Promise.resolve(ok({ devices: [] })));
    live.open({ deviceId: "dev_1" });
    expect(await checkSignIn(live)).toEqual({ kind: "live" });

    const refused = answering(
      async () => await Promise.resolve({ failure: UNAUTHORIZED, ok: false }),
    );
    refused.open({ deviceId: "dev_1" });
    expect(await checkSignIn(refused)).toEqual({ failure: UNAUTHORIZED, kind: "failed" });
    expect(refused.current().kind).toBe("live");
  });

  it("THE FENCE: an answer that lands after its session ended speaks for nothing", async () => {
    const held: HeldAnswer = { answer: null };
    // oxlint-disable-next-line promise/avoid-new -- the answer is released by the test, after the session changed
    const answered = new Promise<CloudResult<ListDevicesResponse>>((resolve) => {
      held.answer = resolve;
    });
    const session = answering(async () => await answered);
    session.open({ deviceId: "dev_1" });
    const checking = checkSignIn(session);
    session.open({ deviceId: "dev_2" });
    held.answer?.({ failure: UNAUTHORIZED, ok: false });

    expect(await checking).toEqual({ kind: "fenced" });
    expect(session.current().kind).toBe("live");
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
    const pass = async (): Promise<SyncOutcome> => {
      running += 1;
      expect(running).toBe(1);
      passes += 1;
      await gates.shift();
      running -= 1;
      return "caught-up";
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
      pass: async (): Promise<SyncOutcome> => {
        passes += 1;
        await held;
        return "caught-up";
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

  it("follows a capped pass at once, until one catches up or the session ends", async () => {
    const flight = createSingleFlight();
    const catchingUp: SyncOutcome[] = ["more", "more", "caught-up", "more"];
    let passes = 0;
    await flight.run({
      onError: () => {},
      pass: async () => {
        passes += 1;
        return await Promise.resolve(catchingUp.shift() ?? "caught-up");
      },
      repeat: () => true,
    });
    expect(passes).toBe(3);

    let ended = 0;
    await flight.run({
      onError: () => {},
      pass: async () => {
        ended += 1;
        return await Promise.resolve<SyncOutcome>("more");
      },
      repeat: () => ended < 2,
    });
    expect(ended).toBe(2);
  });
});
