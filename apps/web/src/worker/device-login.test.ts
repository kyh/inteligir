// `account.signIn` and `account.signOut` as an app calls them over `/v1/rpc`: the account's own
// email and password answered with a device credential, the account's cap on devices, and a
// credential that stops reaching anything the moment it is revoked.

import type { DeviceLoginRequest } from "@repo/contract/cloud/device/device-schema";
import { V1_SOCKET_PATH } from "@repo/contract/cloud/library/library-socket";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { and, eq, isNull } from "drizzle-orm";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anonymous,
  buildHeaders,
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  PASSWORD,
  sessionHeaders,
  signUpUser,
  userIdOf,
  v1Link,
} from "./test-support/cloud-helpers";
import { createDb } from "./db/client";
import { account, device, session, user } from "./db/schema";
import { LAST_SEEN_RESOLUTION_MS } from "./device/device-auth";

// whether a credential still reaches the account: a call any live credential may make
const reaches = async (credential: string): Promise<boolean> => {
  const link = v1Link(deviceHeaders(credential));
  try {
    await link.account.devices.list();
    return true;
  } catch {
    expect(link.statuses.at(-1)).toBe(401);
    return false;
  }
};

const refusalOfSignIn = async (request: DeviceLoginRequest) => {
  const link = anonymous();
  return await link.refusalOf(link.account.signIn(request));
};

const sessionCount = async (userId: string): Promise<number> => {
  const rows = await createDb(env.DB)
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId))
    .all();
  return rows.length;
};

const activeDevices = async (userId: string) =>
  await createDb(env.DB)
    .select()
    .from(device)
    .where(and(eq(device.userId, userId), isNull(device.revokedAt)))
    .all();

const INVALID_CREDENTIALS = { code: "INVALID_CREDENTIALS", defined: true, status: 401 };

describe("device sign-in", () => {
  it("mints a credential that reaches the account, and leaves no session behind", async () => {
    const email = "login-ok@example.test";
    const { cookie } = await signUpUser(email);
    const userId = await userIdOf(cookie);
    const sessionsBefore = await sessionCount(userId);

    const logged = await anonymous().account.signIn({
      deviceName: "Test Laptop",
      email,
      password: PASSWORD,
    });
    expect(logged.credential.startsWith("igd_")).toBe(true);
    expect(logged.userId).toBe(userId);
    expect(logged.email).toBe(email);
    expect(await reaches(logged.credential)).toBe(true);

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
    const { cookie } = await signUpUser("login-case@example.test");
    await anonymous().account.signIn({
      deviceName: "Laptop",
      email: "  Login-Case@Example.TEST ",
      password: PASSWORD,
    });
    const { devices } = await v1Link(sessionHeaders(cookie)).account.devices.list();
    expect(devices.map((row) => row.name)).toEqual(["Laptop"]);
  });

  it("refuses a wrong password without a device row", async () => {
    const email = "login-wrong@example.test";
    const { cookie } = await signUpUser(email);
    const userId = await userIdOf(cookie);

    expect(
      await refusalOfSignIn({ deviceName: "Laptop", email, password: "not-the-password" }),
    ).toMatchObject(INVALID_CREDENTIALS);
    expect(await activeDevices(userId)).toEqual([]);
  });

  it("refuses an address no account has, indistinguishably", async () => {
    expect(
      await refusalOfSignIn({
        deviceName: "Laptop",
        email: "nobody@example.test",
        password: PASSWORD,
      }),
    ).toMatchObject(INVALID_CREDENTIALS);
  });

  it("refuses a user with no credential account the same way — there is no password to check", async () => {
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(user).values({
      createdAt: now,
      email: "passwordless@example.test",
      id: "passwordless-user",
      name: "Passwordless",
      updatedAt: now,
    });
    await db.insert(account).values({
      accountId: "gh-123",
      createdAt: now,
      id: "passwordless-account",
      providerId: "github",
      updatedAt: now,
      userId: "passwordless-user",
    });

    expect(
      await refusalOfSignIn({
        deviceName: "L",
        email: "passwordless@example.test",
        password: PASSWORD,
      }),
    ).toMatchObject(INVALID_CREDENTIALS);
    expect(await activeDevices("passwordless-user")).toEqual([]);
  });

  it("refuses a body it cannot read as a sign-in", async () => {
    // the RPC protocol's own body, with the one field a sign-in cannot do without left out
    const response = await drained(
      exports.default.fetch(`${ORIGIN}${V1_RPC_PATH}/account/signIn`, {
        body: JSON.stringify({ json: { deviceName: "Laptop", email: "login-shape@example.test" } }),
        headers: { ...buildHeaders(), "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses to create a twenty-first active device", async () => {
    const email = "login-cap@example.test";
    const { cookie } = await signUpUser(email);
    const userId = await userIdOf(cookie);
    const db = createDb(env.DB);
    for (let index = 0; index < 20; index += 1) {
      await db.insert(device).values({
        createdAt: new Date(),
        credentialHash: `hash-${index}`,
        id: `cap-device-${index}`,
        name: `Device ${index}`,
        userId,
      });
    }

    expect(
      await refusalOfSignIn({ deviceName: "One Too Many", email, password: PASSWORD }),
    ).toMatchObject({ code: "DEVICE_LIMIT", defined: true, status: 409 });
    expect(await activeDevices(userId)).toHaveLength(20);

    await v1Link(sessionHeaders(cookie)).account.devices.revoke({ deviceId: "cap-device-0" });
    const reopened = await anonymous().account.signIn({
      deviceName: "Now There's Room",
      email,
      password: PASSWORD,
    });
    expect(await reaches(reopened.credential)).toBe(true);
  });

  // which sign-in wins is not asserted: this runtime may serialize the pair, while a deployment
  // lands them on different isolates
  it("cannot be raced past the cap by two sign-ins landing together", async () => {
    const email = "login-cap-race@example.test";
    const { cookie } = await signUpUser(email);
    const userId = await userIdOf(cookie);
    const db = createDb(env.DB);
    for (let index = 0; index < 19; index += 1) {
      await db.insert(device).values({
        createdAt: new Date(),
        credentialHash: `race-hash-${index}`,
        id: `race-device-${index}`,
        name: `Device ${index}`,
        userId,
      });
    }

    const raced = await Promise.allSettled([
      anonymous().account.signIn({ deviceName: "Racer A", email, password: PASSWORD }),
      anonymous().account.signIn({ deviceName: "Racer B", email, password: PASSWORD }),
    ]);
    expect(raced.map((settled) => settled.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(await activeDevices(userId)).toHaveLength(20);
  });

  it("revocation bites on the very next call", async () => {
    const { cookie } = await signUpUser("login-revoke@example.test");
    const { deviceId, credential } = await loginDevice(cookie, "Doomed Laptop");
    expect(await reaches(credential)).toBe(true);

    expect(await v1Link(sessionHeaders(cookie)).account.devices.revoke({ deviceId })).toEqual({
      revoked: true,
    });

    expect(await reaches(credential)).toBe(false);
  });

  it("writes last seen once per resolution window, and still refuses a revoked credential", async () => {
    const { cookie } = await signUpUser("login-last-seen@example.test");
    const { deviceId, credential } = await loginDevice(cookie, "Laptop");
    const db = createDb(env.DB);
    const lastSeen = async (): Promise<number | null> => {
      const row = await db
        .select({ lastSeenAt: device.lastSeenAt })
        .from(device)
        .where(eq(device.id, deviceId))
        .get();
      return row?.lastSeenAt?.getTime() ?? null;
    };
    const setLastSeen = async (msAgo: number): Promise<void> => {
      await db
        .update(device)
        .set({ lastSeenAt: new Date(Date.now() - msAgo) })
        .where(eq(device.id, deviceId));
    };

    expect(await lastSeen()).toBeNull();
    expect(await reaches(credential)).toBe(true);
    expect(await lastSeen()).not.toBeNull();

    await setLastSeen(LAST_SEEN_RESOLUTION_MS / 2);
    const recent = await lastSeen();
    expect(await reaches(credential)).toBe(true);
    expect(await lastSeen()).toBe(recent);

    await setLastSeen(2 * LAST_SEEN_RESOLUTION_MS);
    expect(await reaches(credential)).toBe(true);
    expect(await lastSeen()).toBeGreaterThan(Date.now() - LAST_SEEN_RESOLUTION_MS);

    await v1Link(sessionHeaders(cookie)).account.devices.revoke({ deviceId });
    expect(await reaches(credential)).toBe(false);
  });

  it("lists the account's devices, revoked ones included", async () => {
    const { cookie } = await signUpUser("login-list@example.test");
    const first = await loginDevice(cookie, "Laptop");
    await loginDevice(cookie, "Desktop");
    const site = v1Link(sessionHeaders(cookie));
    await site.account.devices.revoke({ deviceId: first.deviceId });

    const { devices } = await site.account.devices.list();
    expect(devices.map((row) => row.name)).toEqual(["Laptop", "Desktop"]);
    expect(devices[0]?.revokedAt).not.toBeNull();
    expect(devices[1]?.revokedAt).toBeNull();
  });

  it("never lets one account revoke another's device", async () => {
    const alice = await signUpUser("login-alice@example.test");
    const mallory = await signUpUser("login-mallory@example.test");
    const { deviceId, credential } = await loginDevice(alice.cookie, "Alice's Laptop");

    const malloryLink = v1Link(sessionHeaders(mallory.cookie));
    expect(
      await malloryLink.refusalOf(malloryLink.account.devices.revoke({ deviceId })),
    ).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await reaches(credential)).toBe(true);
  });

  it("opens the account's socket on a ticket alone, never on a session or a bearer", async () => {
    const { cookie } = await signUpUser("login-nodevice@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");
    for (const headers of [sessionHeaders(cookie), deviceHeaders(credential)]) {
      const response = await drained(
        exports.default.fetch(`${ORIGIN}${V1_SOCKET_PATH}`, {
          headers: { ...headers, upgrade: "websocket" },
        }),
      );
      expect(response.status).toBe(401);
    }
  });
});

describe("device sign-out", () => {
  it("revokes the credential it was asked with: its next call is refused, a second sign-out too", async () => {
    const { cookie } = await signUpUser("signout-revoke@example.test");
    const { credential } = await loginDevice(cookie, "Leaving Laptop");
    const other = await loginDevice(cookie, "Staying Laptop");

    const leaving = v1Link(deviceHeaders(credential));
    expect(await leaving.account.signOut()).toEqual({ revoked: true });

    expect(await reaches(credential)).toBe(false);
    expect(await leaving.refusalOf(leaving.account.signOut())).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    const active = await activeDevices(await userIdOf(cookie));
    expect(active.map((row) => row.id)).toEqual([other.deviceId]);
    expect(await reaches(other.credential)).toBe(true);
  });

  // each cycle is a password verify, which is slow on purpose
  it(
    "gives the slot back: twenty-one sign-in and sign-out cycles never meet the cap",
    { timeout: 60_000 },
    async () => {
      const { cookie } = await signUpUser("signout-cycles@example.test");
      for (let cycle = 0; cycle < 21; cycle += 1) {
        const { credential } = await loginDevice(cookie, `Laptop ${cycle}`);
        expect(await v1Link(deviceHeaders(credential)).account.signOut()).toEqual({
          revoked: true,
        });
      }
      expect(await activeDevices(await userIdOf(cookie))).toEqual([]);
    },
  );

  it("ends a browser tab's own session alone, and leaves every device signed in", async () => {
    const { cookie } = await signUpUser("signout-session@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");

    const tab = v1Link(sessionHeaders(cookie));
    expect(await tab.account.signOut()).toEqual({ revoked: true });
    expect(await tab.refusalOf(tab.account.devices.list())).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(await reaches(credential)).toBe(true);
  });
});

describe("the sign-in window", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  // eleven password verifies, slow on purpose, outrun five seconds on a CI runner
  it(
    "closes on the eleventh attempt from one address, right or wrong",
    { timeout: 60_000 },
    async () => {
      const email = "login-window@example.test";
      await signUpUser(email);
      const guess = { deviceName: "Guesser", email, password: "not-the-password" };
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect(await refusalOfSignIn(guess)).toMatchObject(INVALID_CREDENTIALS);
      }
      expect(await refusalOfSignIn({ ...guess, password: PASSWORD })).toMatchObject({
        code: "TOO_MANY_REQUESTS",
        defined: true,
        status: 429,
      });
    },
  );
});
