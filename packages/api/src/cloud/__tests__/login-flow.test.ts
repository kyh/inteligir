import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CloudFetch } from "../cloud-client";
import {
  DEVICE_API_PATHS,
  DEVICE_NAME_MAX_LENGTH,
  deviceLoginRequestSchema,
  normalizeDeviceName,
} from "../device/device-schema";
import type { DeviceCredential } from "../device/device-schema";
import { loginDevice } from "../device/login-flow";
import type { DeviceCredentialStore, LoginOutcome } from "../device/login-flow";

const CLOUD_URL = "https://cloud.test";
const LOGGED_IN = { credential: `igd_${"c".repeat(64)}`, deviceId: "dev_x" };

interface RecordedLogin {
  url: string;
  body: string;
}

const loginOk = () => {
  const calls: RecordedLogin[] = [];
  // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
  const fetch: CloudFetch = async (input, init) => {
    calls.push({ body: z.string().parse(init?.body), url: input });
    return Response.json(LOGGED_IN);
  };
  return { calls, fetch };
};

// oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
const loginRefused: CloudFetch = async () =>
  Response.json(
    { error: { code: "invalid-credentials", message: "Wrong email or password." } },
    { status: 401 },
  );

const loginUnreachable: CloudFetch = () => {
  throw new Error("network is down");
};

const memoryStore = () => {
  const written: DeviceCredential[] = [];
  const store: DeviceCredentialStore = {
    // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
    write: async (credential) => {
      written.push(credential);
    },
  };
  return { store, written };
};

const login = async (fetch: CloudFetch, store: DeviceCredentialStore): Promise<LoginOutcome> =>
  await loginDevice({
    client: { baseUrl: CLOUD_URL, fetch },
    deviceName: " Test Laptop ",
    email: "owner@example.test",
    password: "correct horse battery",
    store,
  });

describe("normalizeDeviceName", () => {
  it("trims, bounds to the cloud's ceiling, and defaults an empty name", () => {
    expect(normalizeDeviceName("  Kaiyu's MacBook ")).toBe("Kaiyu's MacBook");
    expect(normalizeDeviceName("x".repeat(200))).toBe("x".repeat(DEVICE_NAME_MAX_LENGTH));
    expect(normalizeDeviceName("   ")).toBe("this device");
  });
});

describe("loginDevice", () => {
  it("posts the login row with the normalized name and writes what came back", async () => {
    const cloud = loginOk();
    const { store, written } = memoryStore();
    const outcome = await login(cloud.fetch, store);
    expect(outcome).toStrictEqual({ credential: LOGGED_IN, kind: "logged-in" });
    expect(written).toStrictEqual([LOGGED_IN]);

    expect(cloud.calls).toHaveLength(1);
    expect(new URL(cloud.calls[0]?.url ?? "").pathname).toBe(DEVICE_API_PATHS.login);
    const body = deviceLoginRequestSchema.parse(JSON.parse(cloud.calls[0]?.body ?? ""));
    expect(body).toStrictEqual({
      deviceName: "Test Laptop",
      email: "owner@example.test",
      password: "correct horse battery",
    });
  });

  it("surfaces the cloud's refusal as a value, and writes nothing", async () => {
    const { store, written } = memoryStore();
    expect(await login(loginRefused, store)).toStrictEqual({
      failure: {
        code: "invalid-credentials",
        deviceSeq: null,
        kind: "refused",
        message: "Wrong email or password.",
      },
      kind: "refused",
    });
    expect(written).toEqual([]);
  });

  it("reports a cloud that did not answer the same way", async () => {
    const { store, written } = memoryStore();
    expect(await login(loginUnreachable, store)).toStrictEqual({
      failure: { kind: "unreachable", message: "network is down" },
      kind: "refused",
    });
    expect(written).toEqual([]);
  });

  it("lets a store that cannot write say so — the credential is not half-adopted", async () => {
    const store: DeviceCredentialStore = {
      write: () => {
        throw new Error("keychain unavailable");
      },
    };
    await expect(login(loginOk().fetch, store)).rejects.toThrow("keychain unavailable");
  });
});
