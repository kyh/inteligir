import { cloudErrorSchema } from "@repo/api/cloud/errors";
import {
  deviceLoginResponseSchema,
  listDevicesResponseSchema,
} from "@repo/api/cloud/device/device-schema";
import { and, eq, isNull } from "drizzle-orm";
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deviceHeaders,
  loginDevice,
  ORIGIN,
  PASSWORD,
  postLogin,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";
import { createDb } from "../db/client";
import { account, device, session, user } from "../db/schema";

function pull(credential: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, { headers: deviceHeaders(credential) });
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await createDb(env.DB)
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId))
    .all();
  return rows.length;
}

async function activeDevices(userId: string) {
  return await createDb(env.DB)
    .select()
    .from(device)
    .where(and(eq(device.userId, userId), isNull(device.revokedAt)))
    .all();
}

async function expectInvalidCredentials(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  const body = cloudErrorSchema.parse(await response.json());
  expect(body.error.code).toBe("invalid-credentials");
  expect(body.error.message).toBe("Wrong email or password.");
}

describe("device login", () => {
  it("mints a credential that reaches the sync surface, and leaves no session behind", async () => {
    const email = "login-ok@example.test";
    const { bearer } = await signUpUser(email);
    const userId = await userIdOf(bearer);
    const sessionsBefore = await sessionCount(userId);

    const response = await postLogin({ email, password: PASSWORD, deviceName: "Test Laptop" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const logged = deviceLoginResponseSchema.parse(await response.json());
    expect(logged.credential.startsWith("igd_")).toBe(true);

    expect((await pull(logged.credential)).status).toBe(200);

    const row = await createDb(env.DB)
      .select()
      .from(device)
      .where(eq(device.id, logged.deviceId))
      .get();
    expect(row?.name).toBe("Test Laptop");
    expect(row?.userId).toBe(userId);
    expect(row?.credentialHash).not.toContain(logged.credential.slice(4));

    // the device holds the igd_ credential and nothing else
    expect(await sessionCount(userId)).toBe(sessionsBefore);
  });

  it("finds the account however the address is cased or padded", async () => {
    const { bearer } = await signUpUser("login-case@example.test");
    const response = await postLogin({
      email: "  Login-Case@Example.TEST ",
      password: PASSWORD,
      deviceName: "Laptop",
    });
    expect(response.status).toBe(200);
    const { devices } = listDevicesResponseSchema.parse(
      await (
        await SELF.fetch(`${ORIGIN}/v1/device/list`, { headers: sessionHeaders(bearer) })
      ).json(),
    );
    expect(devices.map((row) => row.name)).toEqual(["Laptop"]);
  });

  it("refuses a wrong password without a device row", async () => {
    const email = "login-wrong@example.test";
    const { bearer } = await signUpUser(email);
    const userId = await userIdOf(bearer);

    await expectInvalidCredentials(
      await postLogin({ email, password: "not-the-password", deviceName: "Laptop" }),
    );
    expect(await activeDevices(userId)).toEqual([]);
  });

  it("refuses an address no account has, indistinguishably", async () => {
    await expectInvalidCredentials(
      await postLogin({ email: "nobody@example.test", password: PASSWORD, deviceName: "Laptop" }),
    );
  });

  it("refuses a user with no credential account the same way — there is no password to check", async () => {
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(user).values({
      id: "passwordless-user",
      name: "Passwordless",
      email: "passwordless@example.test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(account).values({
      id: "passwordless-account",
      issuer: "github",
      accountId: "gh-123",
      providerId: "github",
      userId: "passwordless-user",
      createdAt: now,
      updatedAt: now,
    });

    await expectInvalidCredentials(
      await postLogin({ email: "passwordless@example.test", password: PASSWORD, deviceName: "L" }),
    );
    expect(await activeDevices("passwordless-user")).toEqual([]);
  });

  it("refuses a body it cannot read as a login", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/device/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "login-shape@example.test", deviceName: "Laptop" }),
    });
    expect(response.status).toBe(400);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("bad-request");
  });

  it("refuses to create a twenty-first active device", async () => {
    const email = "login-cap@example.test";
    const { bearer } = await signUpUser(email);
    const userId = await userIdOf(bearer);
    const db = createDb(env.DB);
    for (let index = 0; index < 20; index += 1) {
      await db.insert(device).values({
        id: `cap-device-${index}`,
        userId,
        name: `Device ${index}`,
        credentialHash: `hash-${index}`,
        createdAt: new Date(),
      });
    }

    const response = await postLogin({ email, password: PASSWORD, deviceName: "One Too Many" });
    expect(response.status).toBe(409);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("device-limit");
    expect(await activeDevices(userId)).toHaveLength(20);

    await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "cap-device-0" }),
    });
    expect(
      (await postLogin({ email, password: PASSWORD, deviceName: "Now There's Room" })).status,
    ).toBe(200);
  });

  // which login wins is not asserted: this runtime may serialize the pair, while a deployment lands them on different isolates
  it("cannot be raced past the cap by two logins landing together", async () => {
    const email = "login-cap-race@example.test";
    const { bearer } = await signUpUser(email);
    const userId = await userIdOf(bearer);
    const db = createDb(env.DB);
    for (let index = 0; index < 19; index += 1) {
      await db.insert(device).values({
        id: `race-device-${index}`,
        userId,
        name: `Device ${index}`,
        credentialHash: `race-hash-${index}`,
        createdAt: new Date(),
      });
    }

    const statuses = (
      await Promise.all([
        postLogin({ email, password: PASSWORD, deviceName: "Racer A" }),
        postLogin({ email, password: PASSWORD, deviceName: "Racer B" }),
      ])
    )
      .map((response) => response.status)
      .toSorted((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect(await activeDevices(userId)).toHaveLength(20);
  });

  it("revocation bites on the very next request", async () => {
    const { bearer } = await signUpUser("login-revoke@example.test");
    const { deviceId, credential } = await loginDevice(bearer, "Doomed Laptop");
    expect((await pull(credential)).status).toBe(200);

    const revoke = await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect(revoke.status).toBe(200);

    const after = await pull(credential);
    expect(after.status).toBe(401);
  });

  it("lists the account's devices, revoked ones included", async () => {
    const { bearer } = await signUpUser("login-list@example.test");
    const first = await loginDevice(bearer, "Laptop");
    await loginDevice(bearer, "Desktop");
    await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: first.deviceId }),
    });

    const response = await SELF.fetch(`${ORIGIN}/v1/device/list`, {
      headers: sessionHeaders(bearer),
    });
    const { devices } = listDevicesResponseSchema.parse(await response.json());
    expect(devices.map((d) => d.name)).toEqual(["Laptop", "Desktop"]);
    expect(devices[0]?.revokedAt).not.toBeNull();
    expect(devices[1]?.revokedAt).toBeNull();
  });

  it("never lets one account revoke another's device", async () => {
    const alice = await signUpUser("login-alice@example.test");
    const mallory = await signUpUser("login-mallory@example.test");
    const { deviceId, credential } = await loginDevice(alice.bearer, "Alice's Laptop");

    const response = await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(mallory.bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect(response.status).toBe(404);
    expect((await pull(credential)).status).toBe(200);
  });

  it("refuses the sync surface without a device credential", async () => {
    const { bearer } = await signUpUser("login-nodevice@example.test");
    const response = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
      headers: sessionHeaders(bearer),
    });
    expect(response.status).toBe(401);
  });
});

describe("the login window", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled = "";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("closes on the eleventh attempt from one address, right or wrong", async () => {
    const email = "login-window@example.test";
    await signUpUser(email);
    const guess = { email, password: "not-the-password", deviceName: "Guesser" };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await postLogin(guess)).status).toBe(401);
    }
    const shut = await postLogin({ ...guess, password: PASSWORD });
    expect(shut.status).toBe(429);
    expect(cloudErrorSchema.parse(await shut.json()).error.code).toBe("rate-limited");
  });
});
