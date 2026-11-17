// Deleting the account, the one way an account ends: the password asked again under a live
// session, and the account's row gone with every device's session. The `account.delete` call that
// reaches it is the /v1 router's.

import { session, user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  cookieHeaderOf,
  mintCode,
  PASSWORD,
  readCode,
  sessionOf,
  signInPhone,
  signUp,
  signUpUser,
  userIdOf,
} from "../test-support/auth-requests";
import { deleteAccountUnderSession } from "./delete-account";

const userExists = async (userId: string): Promise<boolean> => {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  return rows.length > 0;
};

const sessionsOf = async (userId: string) =>
  await db.select().from(session).where(eq(session.userId, userId));

dbSuite("deleting the account", () => {
  it("re-checks the password, and deletes the account and every session it held", async () => {
    const email = "delete-from-app@example.test";
    const { cookie } = await signUpUser(email);
    const laptop = await signInPhone(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);

    await expect(
      deleteAccountUnderSession(new Headers({ cookie: laptop }), PASSWORD),
    ).resolves.toBe("deleted");

    await expect(userExists(userId)).resolves.toBe(false);
    for (const signedIn of [cookie, laptop, phone]) {
      await expect(sessionOf({ cookie: signedIn })).resolves.toBeNull();
    }
    await expect(sessionsOf(userId)).resolves.toStrictEqual([]);
  });

  it("keeps the invite spent, and forgets who spent it", async () => {
    await mintCode("INVITE-FORGOTTEN");
    const signedUp = await signUp({
      email: "Forgotten@Example.test",
      inviteCode: "INVITE-FORGOTTEN",
      name: "Forgotten",
      password: PASSWORD,
    });
    expect(signedUp.status).toBe(200);

    await expect(
      deleteAccountUnderSession(new Headers({ cookie: cookieHeaderOf(signedUp) }), PASSWORD),
    ).resolves.toBe("deleted");

    const row = await readCode("INVITE-FORGOTTEN");
    expect(row?.redeemedBy).toBeNull();
    expect(row?.redeemedAt).not.toBeNull();
  });

  it("refuses a wrong password, and deletes nothing", async () => {
    const email = "delete-wrong-password@example.test";
    const { cookie } = await signUpUser(email);
    const phone = await signInPhone(email);
    const userId = await userIdOf(cookie);

    await expect(
      deleteAccountUnderSession(new Headers({ cookie: phone }), "not-the-password"),
    ).resolves.toBe("invalid-credentials");

    await expect(userExists(userId)).resolves.toBe(true);
    await expect(sessionOf({ cookie: phone })).resolves.not.toBeNull();
    // the sign-up's own session, which the test holds as its cookie, and the phone's
    await expect(sessionsOf(userId)).resolves.toHaveLength(2);
  });

  it("answers signed-out for a session that has already ended", async () => {
    await expect(
      deleteAccountUnderSession(new Headers({ cookie: "nothing=here" }), PASSWORD),
    ).resolves.toBe("signed-out");
  });
});
