import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ACCOUNT_API_PATHS,
  DELETE_ACCOUNT_REFUSALS,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  deviceSignUpRequestSchema,
  isDeleteAccountRefusal,
  signUpRequestSchema,
} from "./account/account-schema";
import { CLOUD_ERROR_CODES, cloudError, cloudErrorSchema } from "./cloud-errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PATTERN,
  DEVICE_LOGIN_REFUSALS,
  DEVICE_NAME_MAX_LENGTH,
  DEVICE_SIGN_UP_REFUSALS,
  deviceLoginRequestSchema,
  deviceLoginResponseSchema,
  isDeviceLoginRefusal,
  isDeviceSignUpRefusal,
  listDevicesResponseSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  revokeDeviceResponseSchema,
} from "./device/device-schema";
import { createCloudClient, readCloudCall } from "./cloud-client";
import type { CloudFailure } from "./cloud-client";
import { TEST_BUILD } from "./test-support/fake-cloud-client";

describe("error envelope", () => {
  it("round-trips through its own schema", () => {
    const envelope = cloudError("unauthorized", "no device credential");
    expect(cloudErrorSchema.parse(envelope)).toEqual(envelope);
  });

  it("reads a code it does not know as internal, keeping the worker's message", () => {
    expect(
      cloudErrorSchema.parse({ error: { code: "teapot", message: "Short and stout." } }),
    ).toEqual({ error: { code: "internal", message: "Short and stout." } });
  });
});

const failureFor = async (response: Response): Promise<CloudFailure | null> => {
  const result = await createCloudClient({
    baseUrl: "https://cloud.test",
    build: TEST_BUILD,
    credential: `igd_${"a".repeat(64)}`,
    fetch: async () => response,
  }).listDevices();
  return result.ok ? null : result.failure;
};

const failureKind = async (response: Response): Promise<CloudFailure["kind"] | null> => {
  const failure = await failureFor(response);
  return failure?.kind ?? null;
};

const edgePage = (status: number): Response =>
  new Response("<html><body>Service Unavailable</body></html>", {
    headers: { "content-type": "text/html" },
    status,
  });

describe("a failure the cloud did not word", () => {
  it("reads an edge's HTML 503 as a cloud it could not reach, not a body to report", async () => {
    expect(await failureFor(edgePage(503))).toStrictEqual({
      kind: "unreachable",
      message: "HTTP 503 with no error body",
    });
  });

  it("reads a bare timeout, throttle or fault the same way", async () => {
    expect(await failureKind(edgePage(408))).toBe("unreachable");
    expect(await failureKind(edgePage(429))).toBe("unreachable");
    expect(await failureKind(new Response("internal error", { status: 500 }))).toBe("unreachable");
  });

  it("keeps a refusal the cloud did word, whatever its status", async () => {
    expect(
      await failureFor(
        Response.json(cloudError("rate-limited", "Too many attempts."), { status: 429 }),
      ),
    ).toStrictEqual({
      code: "rate-limited",
      kind: "refused",
      message: "Too many attempts.",
    });
  });

  it("calls any other unreadable answer malformed", async () => {
    expect(await failureKind(edgePage(403))).toBe("malformed");
  });

  it("reads a request that never left as unreachable, for a reader with no client", async () => {
    const result = await readCloudCall(async () => {
      throw new TypeError("Failed to fetch");
    }, listDevicesResponseSchema);
    expect(result).toStrictEqual({
      failure: { kind: "unreachable", message: "Failed to fetch" },
      ok: false,
    });
  });
});

type Json = z.infer<ReturnType<typeof z.json>>;

const jsonArraySchema = z.array(z.json());
const jsonObjectSchema = z.record(z.string(), z.json());

// a newer worker's answer: every object on the wire gains a field this build never declared,
// except an event body, which the wire carries opaque
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
    ...Object.fromEntries(
      Object.entries(object.data).map(([key, inner]) => [
        key,
        key === "event" ? inner : grown(inner),
      ]),
    ),
    addedByANewerWorker: { nested: [1] },
  };
};

const ANSWERS: readonly (readonly [string, z.ZodType, Json])[] = [
  [
    "a login",
    deviceLoginResponseSchema,
    {
      credential: `igd_${"a".repeat(64)}`,
      deviceId: "dev_1",
      email: "owner@example.test",
      userId: "user_1",
    },
  ],
  [
    "the device list",
    listDevicesResponseSchema,
    {
      devices: [{ createdAt: 1, id: "dev_1", lastSeenAt: null, name: "Laptop", revokedAt: null }],
    },
  ],
  ["a sign-out", revokeDeviceResponseSchema, { revoked: true }],
  ["an account deletion", deleteAccountResponseSchema, { deleted: true }],
  ["a refusal", cloudErrorSchema, { error: { code: "rate-limited", message: "" } }],
];

describe("a worker newer than this build", () => {
  it.each(ANSWERS)(
    "reads %s it grew, and keeps only what this build declares",
    (_name, schema, answer) => {
      expect(schema.parse(grown(answer))).toStrictEqual(answer);
    },
  );

  it("reads a refusal code it does not know as internal: a fault to retry, in the worker's words", async () => {
    const paused = { error: { code: "account-paused", message: "This account is paused." } };
    expect(await failureFor(Response.json(paused, { status: 403 }))).toStrictEqual({
      code: "internal",
      kind: "refused",
      message: "This account is paused.",
    });
  });

  it("still hears a revocation whose envelope grew a field, so the session ends", async () => {
    const envelope = grown({ error: { code: "unauthorized", message: "Signed out." } });
    expect(await failureFor(Response.json(envelope, { status: 401 }))).toMatchObject({
      code: "unauthorized",
      kind: "refused",
    });
  });

  it("hands the caller a grown answer stripped to the declared shape", async () => {
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential: `igd_${"a".repeat(64)}`,
      fetch: async () => Response.json({ devices: [], plan: "pro" }),
    }).listDevices();
    expect(result).toStrictEqual({ ok: true, value: { devices: [] } });
  });
});

describe("device login", () => {
  const LOGIN = {
    deviceName: "Laptop",
    email: "owner@example.test",
    password: "correct horse battery",
  };

  it("folds the email the way the account stores it, and trims what a human pastes", () => {
    const parsed = deviceLoginRequestSchema.parse({
      ...LOGIN,
      deviceName: "  Kaiyu's MacBook ",
      email: "  Owner@Example.TEST ",
    });
    expect(parsed.email).toBe("owner@example.test");
    expect(parsed.deviceName).toBe("Kaiyu's MacBook");
    expect(parsed.password).toBe("correct horse battery");
  });

  it("refuses what is not an address, and never trims a password", () => {
    expect(deviceLoginRequestSchema.safeParse({ ...LOGIN, email: "owner" }).success).toBe(false);
    expect(deviceLoginRequestSchema.parse({ ...LOGIN, password: " padded pw " }).password).toBe(
      " padded pw ",
    );
  });

  it("bounds the password to better auth's own window", () => {
    expect(
      deviceLoginRequestSchema.safeParse({
        ...LOGIN,
        password: "x".repeat(PASSWORD_MIN_LENGTH - 1),
      }).success,
    ).toBe(false);
    expect(
      deviceLoginRequestSchema.safeParse({
        ...LOGIN,
        password: "x".repeat(PASSWORD_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      deviceLoginRequestSchema.safeParse({ ...LOGIN, password: "x".repeat(PASSWORD_MAX_LENGTH) })
        .success,
    ).toBe(true);
  });

  it("bounds the device name and refuses a field it does not know", () => {
    expect(
      deviceLoginRequestSchema.safeParse({
        ...LOGIN,
        deviceName: "x".repeat(DEVICE_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(deviceLoginRequestSchema.safeParse({ ...LOGIN, deviceName: "  " }).success).toBe(false);
    expect(deviceLoginRequestSchema.safeParse({ ...LOGIN, rememberMe: true }).success).toBe(false);
  });

  it("pins the credential shape the server mints, and the answer that carries it", () => {
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(64)}`)).toBe(true);
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(63)}`)).toBe(false);
    expect(DEVICE_CREDENTIAL_PATTERN.test("not-a-credential")).toBe(false);
    const answer = {
      credential: `igd_${"a".repeat(64)}`,
      deviceId: "dev_1",
      email: "owner@example.test",
      userId: "user_1",
    };
    expect(deviceLoginResponseSchema.parse(answer)).toEqual(answer);
    expect(deviceLoginResponseSchema.parse({ ...answer, token: "x" })).toStrictEqual(answer);
    const accountless = { credential: answer.credential, deviceId: answer.deviceId };
    expect(deviceLoginResponseSchema.safeParse(accountless).success).toBe(false);
  });

  it("signs a device out with its own credential, and nothing else", async () => {
    const seen: { path: string; method: string; authorization: string | null }[] = [];
    const credential = `igd_${"a".repeat(64)}`;
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential,
      fetch: async (input, init) => {
        seen.push({
          authorization: new Headers(init?.headers).get("authorization"),
          method: init?.method ?? "GET",
          path: new URL(input).pathname,
        });
        return Response.json({ revoked: true });
      },
    }).signOut();
    expect(result).toStrictEqual({ ok: true, value: { revoked: true } });
    expect(seen).toStrictEqual([
      { authorization: `Bearer ${credential}`, method: "POST", path: DEVICE_API_PATHS.signOut },
    ]);
  });

  it("deletes the account with its own credential and the password asked again", async () => {
    const seen: { path: string; authorization: string | null; body: unknown }[] = [];
    const credential = `igd_${"a".repeat(64)}`;
    const password = " the password, spaces kept ";
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential,
      fetch: async (input, init) => {
        seen.push({
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(z.string().parse(init?.body)),
          path: new URL(input).pathname,
        });
        return Response.json({ deleted: true });
      },
    }).deleteAccount(password);
    expect(result).toStrictEqual({ ok: true, value: { deleted: true } });
    expect(seen).toStrictEqual([
      { authorization: `Bearer ${credential}`, body: { password }, path: ACCOUNT_API_PATHS.delete },
    ]);
    expect(deleteAccountRequestSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(deleteAccountRequestSchema.safeParse({ email: "x", password }).success).toBe(false);
  });

  it("names refusals the envelope can carry, and nothing else as one", () => {
    for (const refusal of DEVICE_LOGIN_REFUSALS) {
      expect(CLOUD_ERROR_CODES).toContain(refusal);
      expect(isDeviceLoginRefusal(refusal)).toBe(true);
    }
    expect(isDeviceLoginRefusal("unauthorized")).toBe(false);
    for (const refusal of DEVICE_SIGN_UP_REFUSALS) {
      expect(CLOUD_ERROR_CODES).toContain(refusal);
      expect(isDeviceSignUpRefusal(refusal)).toBe(true);
    }
    expect(isDeviceSignUpRefusal("device-limit")).toBe(false);
    for (const refusal of DELETE_ACCOUNT_REFUSALS) {
      expect(CLOUD_ERROR_CODES).toContain(refusal);
      expect(isDeleteAccountRefusal(refusal)).toBe(true);
    }
    expect(isDeleteAccountRefusal("unauthorized")).toBe(false);
  });
});

describe("invite sign-up request", () => {
  const SIGN_UP = {
    email: "owner@example.test",
    inviteCode: "INVITE-1",
    name: "Owner",
    password: "correct horse battery",
  };

  it("trims every field but the password", () => {
    expect(
      signUpRequestSchema.parse({
        email: " owner@example.test ",
        inviteCode: " INVITE-1 ",
        name: " Owner ",
        password: " padded pw ",
      }),
    ).toStrictEqual({ ...SIGN_UP, password: " padded pw " });
  });

  it("bounds the password to the window device login and better auth hold", () => {
    for (const [length, accepted] of [
      [PASSWORD_MIN_LENGTH - 1, false],
      [PASSWORD_MIN_LENGTH, true],
      [PASSWORD_MAX_LENGTH, true],
      [PASSWORD_MAX_LENGTH + 1, false],
    ] as const) {
      const password = "x".repeat(length);
      expect(signUpRequestSchema.safeParse({ ...SIGN_UP, password }).success, String(length)).toBe(
        accepted,
      );
    }
  });

  it("refuses a blank name or address and a field it does not know", () => {
    expect(signUpRequestSchema.safeParse({ ...SIGN_UP, name: "  " }).success).toBe(false);
    expect(signUpRequestSchema.safeParse({ ...SIGN_UP, email: "" }).success).toBe(false);
    expect(signUpRequestSchema.safeParse({ ...SIGN_UP, rememberMe: true }).success).toBe(false);
  });

  it("folds the app's address the way login does, and asks for the device's name", () => {
    expect(
      deviceSignUpRequestSchema.parse({
        ...SIGN_UP,
        deviceName: " Laptop ",
        email: " Owner@Example.TEST ",
      }),
    ).toStrictEqual({ ...SIGN_UP, deviceName: "Laptop" });
    expect(deviceSignUpRequestSchema.safeParse(SIGN_UP).success).toBe(false);
    expect(
      deviceSignUpRequestSchema.safeParse({ ...SIGN_UP, deviceName: "L", email: "not-an-address" })
        .success,
    ).toBe(false);
  });
});
