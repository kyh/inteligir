import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CloudFetch } from "../cloud-client";
import {
  DEVICE_API_PATHS,
  DEVICE_NAME_MAX_LENGTH,
  deviceLoginRequestSchema,
  normalizeDeviceName,
  type DeviceCredential,
} from "../device/device-schema";
import { loginDevice, type DeviceCredentialStore, type LoginOutcome } from "../device/login-flow";

const CLOUD_URL = "https://cloud.test";
const LOGGED_IN = { deviceId: "dev_x", credential: `igd_${"c".repeat(64)}` };

interface RecordedLogin {
  url: string;
  body: string;
}

function loginOk() {
  const calls: RecordedLogin[] = [];
  const fetch: CloudFetch = (input, init) => {
    calls.push({ url: input, body: z.string().parse(init?.body) });
    return Promise.resolve(Response.json(LOGGED_IN));
  };
  return { fetch, calls };
}

const loginRefused: CloudFetch = () =>
  Promise.resolve(
    Response.json(
      { error: { code: "invalid-credentials", message: "Wrong email or password." } },
      { status: 401 },
    ),
  );

const loginUnreachable: CloudFetch = () => Promise.reject(new Error("network is down"));

function memoryStore() {
  const written: DeviceCredential[] = [];
  const store: DeviceCredentialStore = {
    write: (credential) => {
      written.push(credential);
      return Promise.resolve();
    },
  };
  return { store, written };
}

function login(fetch: CloudFetch, store: DeviceCredentialStore): Promise<LoginOutcome> {
  return loginDevice({
    client: { baseUrl: CLOUD_URL, fetch },
    store,
    email: "owner@example.test",
    password: "correct horse battery",
    deviceName: " Test Laptop ",
  });
}

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
    expect(outcome).toStrictEqual({ kind: "logged-in", credential: LOGGED_IN });
    expect(written).toStrictEqual([LOGGED_IN]);

    expect(cloud.calls).toHaveLength(1);
    expect(new URL(cloud.calls[0]?.url ?? "").pathname).toBe(DEVICE_API_PATHS.login);
    const body = deviceLoginRequestSchema.parse(JSON.parse(cloud.calls[0]?.body ?? ""));
    expect(body).toStrictEqual({
      email: "owner@example.test",
      password: "correct horse battery",
      deviceName: "Test Laptop",
    });
  });

  it("surfaces the cloud's refusal as a value, and writes nothing", async () => {
    const { store, written } = memoryStore();
    expect(await login(loginRefused, store)).toStrictEqual({
      kind: "refused",
      failure: {
        kind: "refused",
        code: "invalid-credentials",
        message: "Wrong email or password.",
        deviceSeq: null,
      },
    });
    expect(written).toEqual([]);
  });

  it("reports a cloud that did not answer the same way", async () => {
    const { store, written } = memoryStore();
    expect(await login(loginUnreachable, store)).toStrictEqual({
      kind: "refused",
      failure: { kind: "unreachable", message: "network is down" },
    });
    expect(written).toEqual([]);
  });

  it("lets a store that cannot write say so — the credential is not half-adopted", async () => {
    const store: DeviceCredentialStore = {
      write: () => Promise.reject(new Error("keychain unavailable")),
    };
    await expect(login(loginOk().fetch, store)).rejects.toThrow("keychain unavailable");
  });
});
