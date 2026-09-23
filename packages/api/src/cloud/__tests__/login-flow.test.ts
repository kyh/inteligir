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

interface RecordedCall {
  url: string;
  body: string;
  authorization: string | null;
}

// answers the login, and the sign-out a credential nobody kept is owed
const loginOk = () => {
  const calls: RecordedCall[] = [];
  const fetch: CloudFetch = async (input, init) => {
    calls.push({
      authorization: new Headers(init?.headers).get("authorization"),
      body: z.string().parse(init?.body),
      url: input,
    });
    return new URL(input).pathname === DEVICE_API_PATHS.signOut
      ? Response.json({ revoked: true })
      : Response.json(LOGGED_IN);
  };
  return { calls, fetch };
};

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
    const cloud = loginOk();
    const store: DeviceCredentialStore = {
      write: () => {
        throw new Error("keychain unavailable");
      },
    };
    await expect(login(cloud.fetch, store)).rejects.toThrow("keychain unavailable");

    // the cloud already counted the device: the credential nobody kept gives its slot back
    const [, signOut] = cloud.calls;
    expect(cloud.calls).toHaveLength(2);
    expect(new URL(signOut?.url ?? "").pathname).toBe(DEVICE_API_PATHS.signOut);
    expect(signOut?.authorization).toBe(`Bearer ${LOGGED_IN.credential}`);
  });

  it("reports the store's error even when the cloud cannot hear the sign-out", async () => {
    let calls = 0;
    const fetch: CloudFetch = async () => {
      calls += 1;
      if (calls > 1) {
        throw new Error("network is down");
      }
      return Response.json(LOGGED_IN);
    };
    const store: DeviceCredentialStore = {
      write: () => {
        throw new Error("keychain unavailable");
      },
    };
    await expect(login(fetch, store)).rejects.toThrow("keychain unavailable");
    expect(calls).toBe(2);
  });
});
