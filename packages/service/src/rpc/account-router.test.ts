import { session } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  authFetch,
  authPost,
  PASSWORD,
  sessionOf,
  signInPhone,
  signUpUser,
  userIdOf,
} from "../test-support/auth-requests.test-utils";
import { pageHeaders, phoneHeaders, v1Link } from "../test-support/v1-link.test-utils";

const DAY_MS = 86_400_000;

const signedUp = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const phoneCookie = await signInPhone(email);

  return { cookie, phone: v1Link(phoneHeaders(phoneCookie)), phoneCookie };
};

dbSuite("the account's devices", () => {
  it("lists each by the device it signed in from, and refuses one signed out", async () => {
    const { cookie, phone, phoneCookie } = await signedUp("rows-list@example.test");
    const { devices } = await phone.account.devices.list();
    expect(devices.map((row) => [row.name, row.current])).toStrictEqual([
      ["Chrome on Mac", false],
      ["iPhone", true],
    ]);

    const signedOut = await authPost("/sign-out", phoneHeaders(phoneCookie));
    expect(signedOut.status).toBe(200);
    await expect(phone.refusalOf(phone.account.devices.list())).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    await expect(v1Link(pageHeaders(cookie)).account.devices.list()).resolves.toMatchObject({
      devices: [{ current: true, name: "Chrome on Mac" }],
    });
  });

  it("ends one of the account's own sessions by its id, and no other account's", async () => {
    const mine = await signedUp("rows-revoke@example.test");
    const theirs = await signedUp("rows-revoke-other@example.test");
    const tab = v1Link(pageHeaders(mine.cookie));
    const { devices } = await tab.account.devices.list();
    const phoneId = devices.find((device) => !device.current)?.id ?? "";
    const listed = await theirs.phone.account.devices.list();
    const theirPhone = listed.devices.find((device) => device.current);

    await expect(
      tab.refusalOf(tab.account.devices.revoke({ id: theirPhone?.id ?? "" })),
    ).resolves.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(theirs.phone.account.devices.list()).resolves.toMatchObject({
      devices: [{}, {}],
    });

    await expect(tab.account.devices.revoke({ id: phoneId })).resolves.toStrictEqual({
      revoked: true,
    });
    await expect(mine.phone.refusalOf(mine.phone.account.devices.list())).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    await expect(tab.refusalOf(tab.account.devices.revoke({ id: phoneId }))).resolves.toMatchObject(
      { code: "NOT_FOUND", status: 404 },
    );
  });

  it("slides a session only on Better Auth's own read, whose cookie follows it", async () => {
    const { cookie } = await signUpUser("rows-slide@example.test");
    const accountId = await userIdOf(cookie);

    const expiresAt = async () => {
      const [row] = await db
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.userId, accountId));

      return row?.expiresAt.getTime();
    };

    const due = new Date(Date.now() + 5 * DAY_MS);
    await db.update(session).set({ expiresAt: due }).where(eq(session.userId, accountId));

    await v1Link(pageHeaders(cookie)).account.devices.list();
    await expect(expiresAt()).resolves.toBe(due.getTime());

    const read = await authFetch("/get-session", { headers: { cookie } });
    expect(read.headers.getSetCookie().join("\n")).toContain("session_token");
    await expect(expiresAt()).resolves.toBeGreaterThan(due.getTime());
  });
});

dbSuite("deleting the account", () => {
  it("deletes it with its password, and every device is signed out", async () => {
    const { cookie, phone, phoneCookie } = await signedUp("rows-delete@example.test");
    await expect(phone.account.delete({ password: PASSWORD })).resolves.toStrictEqual({
      deleted: true,
    });

    for (const signedIn of [cookie, phoneCookie]) {
      await expect(sessionOf({ cookie: signedIn })).resolves.toBeNull();
    }

    await expect(phone.refusalOf(phone.account.devices.list())).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("refuses a wrong password, and a session past its minute's guesses", async () => {
    const { phone, phoneCookie } = await signedUp("rows-delete-guesses@example.test");
    const refusals = [];

    for (let guess = 0; guess < 6; guess += 1) {
      refusals.push(
        await phone.refusalOf(phone.account.delete({ password: `not-the-password-${guess}` })),
      );
    }

    expect(refusals.map((refusal) => [refusal.code, refusal.status])).toStrictEqual([
      ...Array.from({ length: 5 }, () => ["INVALID_CREDENTIALS", 401]),
      ["TOO_MANY_REQUESTS", 429],
    ]);
    await expect(
      phone.refusalOf(phone.account.delete({ password: PASSWORD })),
    ).resolves.toMatchObject({ code: "TOO_MANY_REQUESTS", defined: true });
    await expect(sessionOf({ cookie: phoneCookie })).resolves.not.toBeNull();
  });
});
