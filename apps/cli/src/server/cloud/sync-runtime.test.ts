import { DEVICE_API_PATHS } from "@repo/contract/cloud/device/device-schema";
import { SYNC_WS_REVOKED_CLOSE_CODE } from "@repo/contract/cloud/sync/sync-ws";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import { setImmediate as tick } from "node:timers/promises";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import type { CloudFetch } from "@repo/contract/cloud/client";
import type { CloudSocket, OpenCloudSocketArgs } from "@repo/contract/cloud/sync/cloud-socket";
import { readDeviceCredential, writeDeviceCredential } from "./credential-store";
import type { DeviceCredential } from "./credential-store";
import { createCloudRuntime } from "./sync-runtime";
import type { CloudRuntime, CloudTransport, LoginOutcome } from "./sync-runtime";
import { makeTempDir } from "../test-support/temp-dir";
import { FAKE_ACCOUNT, FakeCloud } from "./test-support/fake-cloud";

const CLOUD_URL = "https://cloud.test";

const SIGNED_OUT: CloudStatusResponse = {
  cloudUrl: CLOUD_URL,
  revokeError: null,
  state: "signed-out",
};

// the one request the runtime makes on its own while signed in: the check of the sign-in
const CHECK = `GET ${DEVICE_API_PATHS.list}`;

afterEach(() => {
  vi.useRealTimers();
});

interface Harness {
  dataDir: string;
  cloud: FakeCloud;
  runtime: CloudRuntime;
  socketOpens: OpenCloudSocketArgs[];
  vaultPings: () => number;
  /** the status as each onStatusChanged found it. */
  statusNotices: CloudStatusResponse[];
  /** every line of the sync trace, which every harness runs with on. */
  traced: string[];
}

const makeHarness = (
  options: {
    fetch?: CloudFetch;
    pollIntervalMs?: number | null;
    cloud?: FakeCloud;
    /** on disk before the runtime boots, as a restart finds it. */
    credential?: DeviceCredential;
  } = {},
): Harness => {
  const dataDir = makeTempDir("inteligir-sync-");
  if (options.credential !== undefined) {
    writeDeviceCredential(dataDir, options.credential);
  }
  const cloud = options.cloud ?? new FakeCloud();
  const socketOpens: OpenCloudSocketArgs[] = [];
  let vaultPings = 0;
  const statusNotices: CloudStatusResponse[] = [];
  const traced: string[] = [];
  // null before the constructor returns (a stored credential opens its session inside it)
  let asked: CloudRuntime | null = null;
  const transport: CloudTransport = {
    fetch: options.fetch ?? cloud.fetch,
    openSocket: (args): CloudSocket => {
      socketOpens.push(args);
      return { close: () => {} };
    },
  };
  if (options.pollIntervalMs !== undefined) {
    transport.pollIntervalMs = options.pollIntervalMs;
  }
  const runtime = createCloudRuntime({
    build: "0.0.0-test",
    cloudUrl: CLOUD_URL,
    dataDir,
    debugLog: (line) => {
      traced.push(line);
    },
    machineName: "Test Mac",
    onDebug: () => {},
    onStatusChanged: () => {
      if (asked !== null) {
        statusNotices.push(asked.status());
      }
    },
    onVaultPing: () => {
      vaultPings += 1;
    },
    transport,
  });
  asked = runtime;
  onTestFinished(async () => {
    asked = null;
    await runtime.dispose();
  });
  return {
    cloud,
    dataDir,
    runtime,
    socketOpens,
    statusNotices,
    traced,
    vaultPings: () => vaultPings,
  };
};

const loginAs = async (runtime: CloudRuntime, deviceName: string): Promise<LoginOutcome> =>
  await runtime.login({ ...FAKE_ACCOUNT, deviceName });

const signIn = async (harness: Harness): Promise<string> => {
  const outcome = await loginAs(harness.runtime, "Laptop");
  if (outcome.kind !== "logged-in") {
    throw new Error(`login refused: ${JSON.stringify(outcome)}`);
  }
  return outcome.status.state === "signed-in" ? outcome.status.deviceId : "";
};

const lastDial = (harness: Harness): OpenCloudSocketArgs => {
  const dial = harness.socketOpens.at(-1);
  if (dial === undefined) {
    throw new Error("expected a socket dial");
  }
  return dial;
};

const checksOf = (cloud: FakeCloud): number =>
  cloud.requests.filter((route) => route === CHECK).length;

// the socket's open is one of the moments a check runs, as a test can drive it
const checkOnOpen = async (harness: Harness): Promise<void> => {
  const before = checksOf(harness.cloud);
  lastDial(harness).onOpen();
  await vi.waitFor(() => {
    expect(checksOf(harness.cloud)).toBeGreaterThan(before);
  });
  await tick();
};

describe("sync is off until someone signs in", () => {
  it("opens no socket, arms no timer and makes no request", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();

    harness.runtime.start();
    // the check interval is left at its shipping default on purpose.
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(harness.cloud.requests).toEqual([]);
    expect(harness.socketOpens).toEqual([]);
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
  });

  it("makes no request after a logout either, past the one that revokes the device", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const harness = makeHarness();
    await signIn(harness);
    const requestsWhileSignedIn = harness.cloud.requests.length;

    expect(harness.runtime.logout()).toEqual(SIGNED_OUT);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // settles the sign-out, which the logout itself never waits for.
    await harness.runtime.dispose();
    expect(harness.cloud.requests.slice(requestsWhileSignedIn)).toEqual([
      `POST ${DEVICE_API_PATHS.signOut}`,
    ]);
  });
});

describe("signing in", () => {
  it("logs in, leaves the credential in the data dir, and answers once the cloud took it", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);

    const stored = readDeviceCredential(harness.dataDir);
    expect(stored?.credential).toMatch(/^igd_[0-9a-f]{64}$/u);
    expect(stored).toEqual({
      credential: stored?.credential,
      deviceId,
      deviceName: "Laptop",
      email: FAKE_ACCOUNT.email,
      userId: "user_fake",
    });
    expect(harness.runtime.status()).toStrictEqual({
      accountEmail: FAKE_ACCOUNT.email,
      cloudUrl: CLOUD_URL,
      connected: false,
      deviceId,
      lastError: null,
      state: "signed-in",
    });
    expect(harness.cloud.requests).toEqual([`POST ${DEVICE_API_PATHS.login}`, CHECK]);
  });

  it("names the account from the stored sign-in at boot, before any request", async () => {
    const first = makeHarness({ pollIntervalMs: null });
    await signIn(first);
    const stored = readDeviceCredential(first.dataDir);
    if (stored === null) {
      throw new Error("the sign-in kept no credential");
    }
    await first.runtime.dispose();

    const harness = makeHarness({ cloud: first.cloud, credential: stored, pollIntervalMs: null });
    const requestsBefore = first.cloud.requests.length;
    expect(harness.runtime.status()).toMatchObject({
      accountEmail: FAKE_ACCOUNT.email,
      state: "signed-in",
    });
    expect(first.cloud.requests.slice(requestsBefore)).toEqual([]);
  });

  it("checks the stored sign-in once it starts", async () => {
    const first = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(first);
    const stored = readDeviceCredential(first.dataDir);
    if (stored === null) {
      throw new Error("the sign-in kept no credential");
    }
    await first.runtime.dispose();
    first.cloud.revoke(deviceId);

    const harness = makeHarness({ cloud: first.cloud, credential: stored, pollIntervalMs: null });
    harness.runtime.start();

    await vi.waitFor(() => {
      expect(harness.runtime.status()).toMatchObject({ deviceId, state: "unauthorized" });
    });
  });

  it("reports the cloud's own refusal for a wrong password, and keeps nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const outcome = await harness.runtime.login({
      deviceName: "Laptop",
      email: FAKE_ACCOUNT.email,
      password: "not-the-password",
    });
    expect(outcome).toStrictEqual({
      failure: {
        code: "invalid-credentials",
        kind: "refused",
        message: "Wrong email or password.",
      },
      kind: "refused",
    });
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
  });

  it("defaults the device name to this machine's, and keeps the name it signed in under", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const outcome = await harness.runtime.login(FAKE_ACCOUNT);
    expect(outcome.kind).toBe("logged-in");
    expect(harness.cloud.deviceCount()).toBe(1);
    expect(readDeviceCredential(harness.dataDir)?.deviceName).toBe("Test Mac");

    await loginAs(harness.runtime, "  Kai's Laptop ");
    expect(readDeviceCredential(harness.dataDir)?.deviceName).toBe("Kai's Laptop");
  });

  it("kicks the vault once, so the remote the sign-in derived syncs now", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    expect(harness.vaultPings()).toBe(1);
  });

  it("is inert after dispose — a login landing during shutdown writes nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await harness.runtime.dispose();
    const outcome = await loginAs(harness.runtime, "Laptop");
    expect(outcome.kind).toBe("refused");
    expect(harness.cloud.requests).toEqual([]);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
  });
});

describe("a revoked device", () => {
  it("fails closed and surfaces as unauthorized rather than checking forever", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);

    harness.cloud.revoke(deviceId);
    await checkOnOpen(harness);

    const status = harness.runtime.status();
    expect(status).toMatchObject({ deviceId, state: "unauthorized" });
    const requestsAtRefusal = harness.cloud.requests.length;
    lastDial(harness).onOpen();
    await tick();
    expect(harness.cloud.requests).toHaveLength(requestsAtRefusal);
  });

  it("hears the revocation the socket's close hints at", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);

    harness.cloud.revoke(deviceId);
    lastDial(harness).onClose(SYNC_WS_REVOKED_CLOSE_CODE);

    await vi.waitFor(() => {
      expect(harness.runtime.status().state).toBe("unauthorized");
    });
  });

  it("hears one the socket missed on the timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const harness = makeHarness();
    const deviceId = await signIn(harness);

    harness.cloud.revoke(deviceId);
    await vi.advanceTimersByTimeAsync(60_000);

    await vi.waitFor(() => {
      expect(harness.runtime.status().state).toBe("unauthorized");
    });
  });
});

describe("a build below the cloud's floor", () => {
  it("stops as outdated, keeps the sign-in, and asks nothing more", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);

    harness.cloud.buildFloor = "1.0.0";
    await checkOnOpen(harness);

    expect(harness.runtime.status()).toStrictEqual({
      cloudUrl: CLOUD_URL,
      deviceId,
      state: "outdated",
    });
    expect(readDeviceCredential(harness.dataDir)?.deviceId).toBe(deviceId);
    const requestsAtRefusal = harness.cloud.requests.length;
    lastDial(harness).onOpen();
    await tick();
    expect(await harness.runtime.devices()).toMatchObject({ kind: "not-live" });
    expect(harness.cloud.requests).toHaveLength(requestsAtRefusal);
  });

  it("asks the account to drop this device on a sign-out, and says the cloud refused it", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    harness.cloud.buildFloor = "1.0.0";
    await checkOnOpen(harness);

    expect(harness.runtime.logout()).toMatchObject({ revokeError: null, state: "signed-out" });
    await harness.runtime.dispose();
    expect(harness.runtime.status()).toMatchObject({
      revokeError: expect.stringContaining("can't sync"),
      state: "signed-out",
    });
  });
});

type Json = z.infer<ReturnType<typeof z.json>>;

const jsonArraySchema = z.array(z.json());
const jsonObjectSchema = z.record(z.string(), z.json());

// every object a newer worker answers gains a field this build never declared
const grown = (value: Json): Json => {
  const array = jsonArraySchema.safeParse(value);
  if (array.success) {
    return array.data.map(grown);
  }
  const object = jsonObjectSchema.safeParse(value);
  if (!object.success) {
    return value;
  }
  return {
    ...Object.fromEntries(Object.entries(object.data).map(([key, inner]) => [key, grown(inner)])),
    addedByANewerWorker: { nested: [1] },
  };
};

const fromANewerWorker =
  (cloud: FakeCloud): CloudFetch =>
  async (input, init) => {
    const response = await cloud.fetch(input, init);
    const body = z.json().parse(await response.json());
    return Response.json(grown(body), { status: response.status });
  };

describe("a worker newer than this build", () => {
  it("signs in and checks through answers that grew a field", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ cloud, fetch: fromANewerWorker(cloud), pollIntervalMs: null });
    await signIn(harness);

    expect(harness.runtime.status()).toMatchObject({ lastError: null, state: "signed-in" });
    expect(readDeviceCredential(harness.dataDir)?.userId).toBe("user_fake");
  });

  it("still hears a revocation whose refusal grew a field", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ cloud, fetch: fromANewerWorker(cloud), pollIntervalMs: null });
    const deviceId = await signIn(harness);

    cloud.revoke(deviceId);
    await checkOnOpen(harness);

    expect(harness.runtime.status().state).toBe("unauthorized");
  });

  it("reads a refusal code it does not know as a fault, in the worker's words", async () => {
    const cloud = new FakeCloud();
    let paused = false;
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) =>
        paused && new URL(input).pathname === DEVICE_API_PATHS.list
          ? Response.json(
              { error: { code: "account-paused", message: "This account is paused." } },
              { status: 403 },
            )
          : await cloud.fetch(input, init),
      pollIntervalMs: null,
    });
    await signIn(harness);

    paused = true;
    lastDial(harness).onOpen();
    await vi.waitFor(() => {
      const refused = harness.runtime.status();
      expect(refused.state).toBe("signed-in");
      expect(refused.state === "signed-in" ? refused.lastError : null).toMatch(
        /This account is paused\./u,
      );
    });

    paused = false;
    await checkOnOpen(harness);
    expect(harness.runtime.status()).toMatchObject({ lastError: null, state: "signed-in" });
  });
});

describe("the sync trace", () => {
  it("says each check's verdict by its session, and no answer's body", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);
    harness.cloud.revoke(deviceId);
    await checkOnOpen(harness);

    expect(harness.traced).toEqual(["session 1 check: live", "session 1 check: refused"]);
  });
});

describe("the account socket", () => {
  it("dials once signed in, and announces only that it is a socket", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    expect(harness.socketOpens).toHaveLength(1);
    expect(lastDial(harness)).toMatchObject({ baseUrl: CLOUD_URL, credential: expect.any(String) });
  });

  it("routes a vault ping to the vault hook and asks the cloud nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    const quiet = harness.cloud.requests.length;

    lastDial(harness).onPing({ type: "vault" });
    expect(harness.vaultPings()).toBe(2);
    expect(harness.cloud.requests).toHaveLength(quiet);
  });

  it("catches up once it opens: a ping sent while it was down reached nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);

    await checkOnOpen(harness);

    expect(harness.vaultPings()).toBe(2);
    expect(harness.statusNotices).toContainEqual(expect.objectContaining({ connected: true }));
    expect(harness.runtime.pingsReach()).toBe(true);
  });
});

describe("the status bus", () => {
  it("announces a sign-in, the end of every check and a revocation, so nothing polls", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);
    expect(harness.statusNotices.at(-1)).toMatchObject({ deviceId, state: "signed-in" });

    harness.cloud.revoke(deviceId);
    await checkOnOpen(harness);
    expect(harness.statusNotices).toContainEqual(
      expect.objectContaining({ state: "unauthorized" }),
    );
  });
});

interface Gate {
  arm: () => void;
  fetch: CloudFetch;
  reached: Promise<void>;
  release: () => void;
}

// holds the first armed request to `path` until release, failing it if its signal aborts first
const gatedFetch = (cloud: FakeCloud, path: string): Gate => {
  const reachedGate: PromiseWithResolvers<void> = Promise.withResolvers();
  const heldGate: PromiseWithResolvers<void> = Promise.withResolvers();
  let armed = false;
  let fired = false;
  const fetch: CloudFetch = async (input, init) => {
    if (!armed || fired || new URL(input).pathname !== path) {
      return await cloud.fetch(input, init);
    }
    fired = true;
    reachedGate.resolve();
    const aborted: PromiseWithResolvers<void> = Promise.withResolvers();
    init?.signal?.addEventListener("abort", () => {
      aborted.reject(new Error("aborted"));
    });
    await Promise.race([heldGate.promise, aborted.promise]);
    return await cloud.fetch(input, init);
  };
  return {
    arm: () => {
      armed = true;
    },
    fetch,
    reached: reachedGate.promise,
    release: heldGate.resolve,
  };
};

describe("a session that changes mid-check", () => {
  it("does not let an earlier sign-in's refusal end the next one", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, DEVICE_API_PATHS.list);
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    const first = await signIn(harness);

    gate.arm();
    lastDial(harness).onOpen();
    await gate.reached;
    cloud.revoke(first);
    const second = await loginAs(harness.runtime, "Laptop again");
    gate.release();
    await tick();
    await tick();

    expect(second.kind).toBe("logged-in");
    expect(harness.runtime.status()).toMatchObject({ deviceId: "dev_2", state: "signed-in" });
  });
});

describe("dispose", () => {
  it("cancels a check rather than waiting it out", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, DEVICE_API_PATHS.list);
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    await signIn(harness);

    gate.arm();
    lastDial(harness).onOpen();
    await gate.reached;

    await harness.runtime.dispose();
    const requestsAtDispose = cloud.requests.length;
    gate.release();
    await tick();
    expect(cloud.requests).toHaveLength(requestsAtDispose);
  });
});

// a logout never waits for its sign-out, so the cloud's side lands a beat later
const activeDevicesSettle = async (cloud: FakeCloud, count: number): Promise<void> => {
  await vi.waitFor(() => {
    expect(cloud.activeDeviceCount()).toBe(count);
  });
};

describe("signing out", () => {
  it("gives the device's slot back, so sign-in cycles never meet the account's cap", async () => {
    const cloud = new FakeCloud();
    cloud.maxDevices = 20;
    const harness = makeHarness({ cloud, pollIntervalMs: null });

    for (let cycle = 0; cycle < 25; cycle += 1) {
      const outcome = await loginAs(harness.runtime, `Laptop ${cycle}`);
      expect(outcome.kind).toBe("logged-in");
      harness.runtime.logout();
      await activeDevicesSettle(cloud, 0);
    }
    expect(cloud.deviceCount()).toBe(25);
  });

  it("gives the previous sign-in's slot back when signing in again without signing out", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    await loginAs(harness.runtime, "Laptop again");

    await activeDevicesSettle(harness.cloud, 1);
    expect(harness.runtime.status()).toMatchObject({ deviceId: "dev_2", state: "signed-in" });
  });

  it("lands after the session it ended, and a shutdown waits for it", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, DEVICE_API_PATHS.signOut);
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    await signIn(harness);

    gate.arm();
    harness.runtime.logout();
    await gate.reached;
    let disposed = false;
    const disposing = (async () => {
      await harness.runtime.dispose();
      disposed = true;
    })();
    await tick();
    expect(disposed).toBe(false);

    gate.release();
    await disposing;
    expect(cloud.activeDeviceCount()).toBe(0);
  });

  it("holds a shutdown for a sign-out the cloud never answers only until the grace runs out", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, DEVICE_API_PATHS.signOut);
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    await signIn(harness);

    gate.arm();
    harness.runtime.logout();
    await gate.reached;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let disposed = false;
    const disposing = (async () => {
      await harness.runtime.dispose();
      disposed = true;
    })();
    await vi.advanceTimersByTimeAsync(2999);
    expect(disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await disposing;
    expect(cloud.activeDeviceCount()).toBe(1);
  });

  it("signs out here even when the cloud cannot hear it", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) => {
        if (new URL(input).pathname === DEVICE_API_PATHS.signOut) {
          throw new Error("network is down");
        }
        return await cloud.fetch(input, init);
      },
      pollIntervalMs: null,
    });
    await signIn(harness);

    expect(harness.runtime.logout()).toEqual(SIGNED_OUT);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    await harness.runtime.dispose();
    expect(cloud.activeDeviceCount()).toBe(1);
  });

  it("says a revoke the cloud did not take on the signed-out status, until the next login", async () => {
    const cloud = new FakeCloud();
    let signOutDown = true;
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) =>
        signOutDown && new URL(input).pathname === DEVICE_API_PATHS.signOut
          ? new Response(null, { status: 503 })
          : await cloud.fetch(input, init),
      pollIntervalMs: null,
    });
    await signIn(harness);

    expect(harness.runtime.logout()).toEqual(SIGNED_OUT);
    await vi.waitFor(() => {
      expect(harness.runtime.status()).toMatchObject({
        revokeError: expect.stringMatching(/HTTP 503/u),
        state: "signed-out",
      });
    });
    expect(harness.statusNotices.at(-1)).toMatchObject({ revokeError: expect.any(String) });

    signOutDown = false;
    await signIn(harness);
    harness.runtime.logout();
    await activeDevicesSettle(cloud, 1);
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
  });

  it("says nothing for a revoke the cloud refused because the device was already gone", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    harness.cloud.revoke(await signIn(harness));

    harness.runtime.logout();
    await harness.runtime.dispose();
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
  });

  it("asks nothing of the cloud for a credential it already refused", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    harness.cloud.revoke(await signIn(harness));
    await checkOnOpen(harness);
    expect(harness.runtime.status().state).toBe("unauthorized");
    const requestsAtRefusal = harness.cloud.requests.length;

    harness.runtime.logout();
    await harness.runtime.dispose();
    expect(harness.cloud.requests).toHaveLength(requestsAtRefusal);
  });
});

describe("every cloud call carries a deadline", () => {
  it("attaches a signal to every request, login included", async () => {
    const cloud = new FakeCloud();
    const signalled: { path: string; hasSignal: boolean }[] = [];
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) => {
        signalled.push({
          hasSignal: init?.signal instanceof AbortSignal,
          path: new URL(input).pathname,
        });
        return await cloud.fetch(input, init);
      },
      pollIntervalMs: null,
    });
    await signIn(harness);
    await checkOnOpen(harness);
    harness.runtime.logout();
    await harness.runtime.dispose();

    expect(signalled.map((call) => call.path)).toEqual([
      DEVICE_API_PATHS.login,
      DEVICE_API_PATHS.list,
      DEVICE_API_PATHS.list,
      DEVICE_API_PATHS.signOut,
    ]);
    expect(signalled.filter((call) => !call.hasSignal)).toEqual([]);
  });
});
