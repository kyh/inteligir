// oxlint-disable eslint/require-await -- the CloudFetch and credential-store stand-ins here answer
// synchronously; `async` is the port's contract, and dropping it trips promise-function-async
import type { CloudFetch } from "@repo/api/cloud/client";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLoginStore } from "../login-store";

const LOGGED_IN = { credential: `igd_${"c".repeat(64)}`, deviceId: "dev_x" };
const REQUEST = {
  deviceName: "Phone",
  email: "owner@example.test",
  password: "correct horse battery",
};

const loginOk =
  (calls: string[] = []): CloudFetch =>
  async (_input, init) => {
    calls.push(z.string().parse(init?.body));
    return Response.json(LOGGED_IN);
  };

const loginRefused: CloudFetch = async () =>
  Response.json(
    { error: { code: "invalid-credentials", message: "Wrong email or password." } },
    { status: 401 },
  );

const noop = (): void => {};

// released from outside, so a test can look at the state while the login is in flight
const heldLogin = () => {
  let markReached: () => void = noop;
  let release: () => void = noop;
  // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the login by hand
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the login by hand
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch: CloudFetch = async () => {
    markReached();
    await released;
    return Response.json(LOGGED_IN);
  };
  return {
    fetch,
    reached,
    release: () => {
      release();
    },
  };
};

const harness = (args: {
  fetch: CloudFetch;
  write?: (credential: DeviceCredential) => Promise<void>;
}) => {
  const written: DeviceCredential[] = [];
  const store = createLoginStore({
    client: { baseUrl: "https://cloud.test", fetch: args.fetch },
    store: {
      write:
        args.write ??
        (async (credential) => {
          written.push(credential);
        }),
    },
  });
  return { store, written };
};

describe("the login store", () => {
  it("is signing in while the cloud answers, and idle once the credential is this phone's", async () => {
    const wire = heldLogin();
    const { store, written } = harness({ fetch: wire.fetch });
    expect(store.get()).toStrictEqual({ kind: "idle" });

    const run = store.login(REQUEST);
    await wire.reached;
    expect(store.get()).toStrictEqual({ kind: "signing-in" });
    // identity, not equality: a snapshot rebuilt per read loops useSyncExternalStore.
    expect(store.get()).toBe(store.get());

    wire.release();
    await run;
    expect(written).toStrictEqual([LOGGED_IN]);
    expect(store.get()).toStrictEqual({ kind: "idle" });
  });

  it("sends the credentials as typed, with the device name the phone chose", async () => {
    const calls: string[] = [];
    const { store } = harness({ fetch: loginOk(calls) });
    await store.login(REQUEST);
    expect(JSON.parse(calls[0] ?? "")).toStrictEqual(REQUEST);
  });

  it("shows the cloud's refusal", async () => {
    const { store, written } = harness({ fetch: loginRefused });
    await store.login(REQUEST);
    expect(written).toHaveLength(0);
    expect(store.get()).toStrictEqual({ kind: "failed", message: "Wrong email or password." });
  });

  it("lands a thrown keychain as a failure, not a spinner that never ends", async () => {
    const { store } = harness({
      fetch: loginOk(),
      write: async () => {
        throw new Error("keychain unavailable");
      },
    });
    await store.login(REQUEST);
    expect(store.get()).toStrictEqual({ kind: "failed", message: "keychain unavailable" });
  });

  it("treats a second tap during a sign-in as the same sign-in", async () => {
    let calls = 0;
    const wire = heldLogin();
    const { store } = harness({
      fetch: async (input, init) => {
        calls += 1;
        return await wire.fetch(input, init);
      },
    });
    const first = store.login(REQUEST);
    await wire.reached;
    await store.login(REQUEST);
    wire.release();
    await first;
    expect(calls).toBe(1);
  });
});
