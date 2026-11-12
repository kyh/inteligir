// `account.delete`, the one way an account ends: the password asked again under a live session,
// and the account's row gone with every device's session. What the purge takes is
// `library/library-do.test.ts`'s, and the door a session comes through `wire/v1-rpc.test.ts`'s.

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markGrantRevoked } from "./connector/revoked-grants";
import { createDb } from "@repo/db/d1/client";
import { rateLimit, revokedGrant, session, user } from "@repo/db/d1/schema";
import { holderRateKey } from "./rate-limit";
import {
  PASSWORD,
  phoneHeaders,
  sessionIdOf,
  signInPhone,
  signUpUser,
  userIdOf,
  v1Link,
} from "./test-support/cloud-helpers";

// whether a phone's session still reaches the account: a call any live session may make
const reaches = async (cookie: string): Promise<boolean> => {
  const link = v1Link(phoneHeaders(cookie));
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

describe("deleting the account", () => {
  it("re-checks the password, and deletes the account and every session it held", async () => {
    const email = "delete-from-app@example.test";
    const { cookie } = await signUpUser(email);
    const laptop = await signInPhone(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);
    const db = createDb(env.DB);
    await markGrantRevoked(db, { accountId: userId, grantId: "disconnected" });

    await expect(deleteAs(phoneHeaders(laptop), PASSWORD).deletion).resolves.toStrictEqual({
      deleted: true,
    });

    await expect(userExists(userId)).resolves.toBe(false);
    for (const signedIn of [laptop, phone]) {
      await expect(reaches(signedIn)).resolves.toBe(false);
    }
    // no session or revoked grant outlives the account
    await expect(
      db.select().from(session).where(eq(session.userId, userId)).all(),
    ).resolves.toStrictEqual([]);
    await expect(
      db.select().from(revokedGrant).where(eq(revokedGrant.userId, userId)).all(),
    ).resolves.toStrictEqual([]);
  });

  it("refuses a wrong password, and deletes nothing", async () => {
    const email = "delete-wrong-password@example.test";
    const { cookie } = await signUpUser(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);

    await expect(refusalOfDelete(phoneHeaders(phone), "not-the-password")).resolves.toMatchObject({
      code: "INVALID_CREDENTIALS",
      defined: true,
      status: 401,
    });

    await expect(userExists(userId)).resolves.toBe(true);
    await expect(reaches(phone)).resolves.toBe(true);
    const sessions = await createDb(env.DB)
      .select()
      .from(session)
      .where(eq(session.userId, userId))
      .all();
    // the sign-up's own session, which the test holds as its cookie, and the phone's
    expect(sessions).toHaveLength(2);
  });
});

describe("the deletion's per-holder budget", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("refuses the session past its window before checking the password", async () => {
    const email = "delete-budget@example.test";
    const { cookie } = await signUpUser(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);
    const spent = { count: 1_000_000, lastRequest: Date.now() };
    const key = holderRateKey("accountDelete", await sessionIdOf(phone));
    await createDb(env.DB)
      .insert(rateLimit)
      .values({ id: crypto.randomUUID(), key, ...spent })
      .onConflictDoUpdate({ set: spent, target: rateLimit.key });

    await expect(refusalOfDelete(phoneHeaders(phone), PASSWORD)).resolves.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      defined: true,
      status: 429,
    });
    await expect(userExists(userId)).resolves.toBe(true);
  });
});
