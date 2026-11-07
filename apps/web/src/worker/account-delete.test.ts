// `account.delete`, the one way an account ends: the password asked again under a live credential,
// and everything the account held gone with it, its sockets and every device's credential too.

import { env, exports } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./db/client";
import { inviteCode, rateLimit, session, user } from "./db/schema";
import { holderRateKey } from "./rate-limit";
import {
  buildHeaders,
  deviceHeaders,
  drained,
  loginDevice,
  openSocket,
  ORIGIN,
  PASSWORD,
  sessionHeaders,
  signUpUser,
  userIdOf,
  v1Link,
} from "./test-support/cloud-helpers";

// whether a credential still reaches the account: a call any live credential may make
const reaches = async (credential: string): Promise<boolean> => {
  const link = v1Link(deviceHeaders(credential));
  try {
    await link.account.devices.list();
    return true;
  } catch {
    return false;
  }
};

const deleteAs = (headers: Record<string, string>, password: string) => {
  const link = v1Link(headers);
  return { deletion: link.account.delete({ password }), link };
};

const refusalOfDelete = async (headers: Record<string, string>, password: string) => {
  const { deletion, link } = deleteAs(headers, password);
  return await link.refusalOf(deletion);
};

const userExists = async (userId: string): Promise<boolean> =>
  (await createDb(env.DB).select().from(user).where(eq(user.id, userId)).get()) !== undefined;

const inviteOf = async (email: string) =>
  await createDb(env.DB)
    .select()
    .from(inviteCode)
    .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`)
    .get();

describe("deleting the account", () => {
  it("re-checks the password and deletes everything the account holds", async () => {
    const email = "delete-from-app@example.test";
    const { cookie } = await signUpUser(email);
    const laptop = await loginDevice(cookie, "Laptop");
    const phone = await loginDevice(cookie, "Phone");
    const userId = await userIdOf(cookie);
    const invite = await inviteOf(email);
    expect(invite).toBeDefined();

    const phoneSocket = await openSocket(phone.credential);
    // oxlint-disable-next-line promise/avoid-new -- the close code arrives as a socket event, which only a promise can hand to an await
    const phoneClosed = new Promise<number>((resolve) => {
      phoneSocket.socket.addEventListener("close", (close) => {
        resolve(close.code);
      });
    });

    await expect(
      deleteAs(deviceHeaders(laptop.credential), PASSWORD).deletion,
    ).resolves.toStrictEqual({
      deleted: true,
    });

    await expect(userExists(userId)).resolves.toBe(false);
    for (const credential of [laptop.credential, phone.credential]) {
      await expect(reaches(credential)).resolves.toBe(false);
    }
    // the sign-in that checked the password minted a session; none outlives the account
    const sessions = await createDb(env.DB)
      .select()
      .from(session)
      .where(eq(session.userId, userId))
      .all();
    expect(sessions).toStrictEqual([]);

    // the account's sockets close with it, the phone's still-open one included
    await expect(phoneClosed).resolves.toBe(1001);

    const spent = await createDb(env.DB)
      .select()
      .from(inviteCode)
      .where(eq(inviteCode.code, invite?.code ?? ""))
      .get();
    expect(spent?.redeemedBy).toBeNull();
    expect(spent?.redeemedAt).not.toBeNull();
  });

  it("refuses a wrong password, and deletes nothing", async () => {
    const { cookie } = await signUpUser("delete-wrong-password@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");
    const userId = await userIdOf(cookie);

    await expect(
      refusalOfDelete(deviceHeaders(credential), "not-the-password"),
    ).resolves.toMatchObject({
      code: "INVALID_CREDENTIALS",
      defined: true,
      status: 401,
    });

    await expect(userExists(userId)).resolves.toBe(true);
    await expect(reaches(credential)).resolves.toBe(true);
    const sessions = await createDb(env.DB)
      .select()
      .from(session)
      .where(eq(session.userId, userId))
      .all();
    // the sign-up's own session, which the test holds as its cookie
    expect(sessions).toHaveLength(1);
  });

  it("refuses a caller with no live credential, and deletes nothing", async () => {
    const { cookie } = await signUpUser("delete-no-credential@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");
    const revoked = await loginDevice(cookie, "Old Phone");
    await v1Link(deviceHeaders(revoked.credential)).account.signOut();
    const userId = await userIdOf(cookie);

    const callers = [
      // the cookie counts only on a request the site's own page made
      {
        caller: "another site's page riding the session",
        headers: { ...buildHeaders(), cookie, "sec-fetch-site": "cross-site" },
      },
      { caller: "a revoked credential", headers: deviceHeaders(revoked.credential) },
      { caller: "no credential", headers: buildHeaders() },
    ];
    for (const { caller, headers } of callers) {
      await expect(refusalOfDelete(headers, PASSWORD), caller).resolves.toMatchObject({
        code: "UNAUTHORIZED",
        status: 401,
      });
    }

    await expect(userExists(userId)).resolves.toBe(true);
    await expect(reaches(credential)).resolves.toBe(true);
  });

  it("deletes from the library's own tab on its session, the password asked again", async () => {
    const { cookie } = await signUpUser("delete-from-tab@example.test");
    const userId = await userIdOf(cookie);
    await expect(deleteAs(sessionHeaders(cookie), PASSWORD).deletion).resolves.toStrictEqual({
      deleted: true,
    });
    await expect(userExists(userId)).resolves.toBe(false);
  });
});

describe("Better Auth's own deletion routes", () => {
  it("answer 404 to a fresh browser session, and the account survives", async () => {
    const { cookie } = await signUpUser("delete-through-better-auth@example.test");
    const userId = await userIdOf(cookie);

    const deletion = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/delete-user`, {
        body: "{}",
        headers: { ...sessionHeaders(cookie), "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(deletion.status).toBe(404);
    const callback = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/delete-user/callback?token=any`, {
        headers: sessionHeaders(cookie),
      }),
    );
    expect(callback.status).toBe(404);

    await expect(userExists(userId)).resolves.toBe(true);
    await expect(userIdOf(cookie)).resolves.toBe(userId);
  });
});

describe("the deletion's per-device budget", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("refuses the device past its window before checking the password", async () => {
    const { cookie } = await signUpUser("delete-budget@example.test");
    const { credential, deviceId } = await loginDevice(cookie, "Laptop");
    const userId = await userIdOf(cookie);
    const spent = { count: 1_000_000, lastRequest: Date.now() };
    await createDb(env.DB)
      .insert(rateLimit)
      .values({ id: crypto.randomUUID(), key: holderRateKey("accountDelete", deviceId), ...spent })
      .onConflictDoUpdate({ set: spent, target: rateLimit.key });

    await expect(refusalOfDelete(deviceHeaders(credential), PASSWORD)).resolves.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      defined: true,
      status: 429,
    });
    await expect(userExists(userId)).resolves.toBe(true);
  });
});
