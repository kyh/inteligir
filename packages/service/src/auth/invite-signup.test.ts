import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import {
  askSignUpCode,
  authFetch,
  authPost,
  CALLER_IP_HEADER,
  cookieHeaderOf,
  mintCode,
  mintSignInCode,
  ORIGIN,
  readCode,
  sessionOf,
  signInWithCode,
  signUp,
  signUpUser,
} from "../test-support/auth-requests.test-utils";

const UNLISTED_AUTH_ROUTES = [
  ["GET", "/list-sessions"],
  ["POST", "/delete-user"],
  ["GET", "/callback/x"],
  ["POST", "/get-session"],
  ["POST", "/sign-in/email"],
  ["POST", "/sign-up/email"],
  ["POST", "/request-password-reset"],
] as const;

const INVITE_REFUSED = "That invite code doesn't work.";
const ACCOUNT_EXISTS = "An account already uses that email. Sign in instead.";
const CODE_REFUSED = "That code didn't work. Check it, or send a new one.";

const signInBodySchema = z.looseObject({ token: z.string() });

const signInAs = async (email: string) => await signInWithCode(email, { origin: ORIGIN });

const accountsAt = async (email: string) =>
  await db.select({ id: user.id }).from(user).where(eq(user.email, email));

const invited = async (email: string, inviteCode: string, name = "Invited") => ({
  code: await mintSignInCode(email),
  email,
  inviteCode,
  name,
});

dbSuite("invite-gated sign-up", () => {
  it("creates the account from its mailed code and burns the invite", async () => {
    await mintCode("INVITE-OK");

    const response = await signUp(await invited("ada@example.test", "INVITE-OK", "Ada"));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-auth-token")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBeNull();
    expect(response.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(true);
    const signedIn = await sessionOf({ cookie: cookieHeaderOf(response) });
    expect(signedIn?.user).toMatchObject({ email: "ada@example.test", name: "Ada" });

    const row = await readCode("INVITE-OK");
    expect(row?.redeemedBy).toBe("ada@example.test");
    expect(row?.redeemedAt).not.toBeNull();
  });

  it("refuses an unknown invite without creating anything", async () => {
    const response = await signUp(await invited("mallory@example.test", "NO-SUCH-CODE"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ message: INVITE_REFUSED });
    await expect(accountsAt("mallory@example.test")).resolves.toStrictEqual([]);
  });

  it("refuses an invite that has already been redeemed", async () => {
    await mintCode("INVITE-ONCE");
    const first = await signUp(await invited("first@example.test", "INVITE-ONCE"));
    expect(first.status).toBe(200);

    const second = await signUp(await invited("second@example.test", "INVITE-ONCE"));
    expect(second.status).toBe(403);
    await expect(second.json()).resolves.toStrictEqual({ message: INVITE_REFUSED });
    const claimed = await readCode("INVITE-ONCE");
    expect(claimed?.redeemedBy).toBe("first@example.test");
  });

  it("refuses an address an account holds, before the invite is claimed", async () => {
    await signUpUser("taken@example.test");
    await mintCode("INVITE-AGAIN");

    const response = await signUp(await invited("Taken@Example.test", "INVITE-AGAIN"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toStrictEqual({ message: ACCOUNT_EXISTS });

    const row = await readCode("INVITE-AGAIN");
    expect(row?.redeemedAt).toBeNull();
  });

  it("releases the claim when the code is wrong", async () => {
    await mintCode("INVITE-WRONG");
    const asked = await invited("wrong@example.test", "INVITE-WRONG");
    const code = asked.code === "000000" ? "111111" : "000000";

    const response = await signUp({ ...asked, code });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ message: CODE_REFUSED });

    const row = await readCode("INVITE-WRONG");
    expect(row?.redeemedAt).toBeNull();
    expect(row?.redeemedBy).toBeNull();
    await expect(accountsAt("wrong@example.test")).resolves.toStrictEqual([]);
  });

  it("refuses a malformed body or code before touching the invite", async () => {
    await mintCode("INVITE-UNTOUCHED");

    const malformed = await signUp({ inviteCode: "INVITE-UNTOUCHED" });
    expect(malformed.status).toBe(400);

    const shortCode = await signUp({
      code: "123",
      email: "short@example.test",
      inviteCode: "INVITE-UNTOUCHED",
      name: "Short",
    });

    expect(shortCode.status).toBe(400);
    await expect(shortCode.json()).resolves.toStrictEqual({ message: CODE_REFUSED });
    const untouched = await readCode("INVITE-UNTOUCHED");
    expect(untouched?.redeemedAt).toBeNull();
  });

  it("mails a code for an open invite and a new address, and spends neither", async () => {
    await mintCode("INVITE-ASK");
    const logged = vi.spyOn(console, "log");

    const asked = await askSignUpCode({ email: "asker@example.test", inviteCode: "INVITE-ASK" });
    expect(asked.status).toBe(200);
    expect(logged.mock.calls.flat().join("\n")).toMatch(/\d{6} is your inteligir sign-in code/u);
    logged.mockRestore();

    const row = await readCode("INVITE-ASK");
    expect(row?.redeemedAt).toBeNull();
    await expect(accountsAt("asker@example.test")).resolves.toStrictEqual([]);
  });

  it("mails no code for an unknown invite or an address an account holds", async () => {
    await signUpUser("holder@example.test");
    await mintCode("INVITE-HOLDER");

    const unknown = await askSignUpCode({ email: "x@example.test", inviteCode: "NOPE-NOPE" });
    expect(unknown.status).toBe(403);

    const held = await askSignUpCode({ email: "holder@example.test", inviteCode: "INVITE-HOLDER" });
    expect(held.status).toBe(409);
    await expect(held.json()).resolves.toStrictEqual({ message: ACCOUNT_EXISTS });
  });

  it("never makes an account from the public sign-in, with a code or without", async () => {
    const logged = vi.spyOn(console, "log");

    const sent = await authPost(
      "/email-otp/send-verification-otp",
      { origin: ORIGIN },
      { email: "stranger@example.test", type: "sign-in" },
    );

    expect(sent.status).toBe(200);
    expect(logged.mock.calls.flat().join("\n")).not.toContain("stranger@example.test");
    logged.mockRestore();

    const signIn = await signInAs("stranger@example.test");
    expect(signIn.status).toBe(400);
    await expect(accountsAt("stranger@example.test")).resolves.toStrictEqual([]);
  });

  it("answers 404 on a Better Auth route no client calls, even to a signed-in browser", async () => {
    const { cookie } = await signUpUser("surface@example.test");
    const headers = { cookie, origin: ORIGIN };

    for (const [method, path] of UNLISTED_AUTH_ROUTES) {
      const response = await authFetch(path, {
        body: method === "POST" ? "{}" : undefined,
        headers: { ...headers, "content-type": "application/json" },
        method,
      });

      expect(response.status, `${method} ${path}`).toBe(404);
      await expect(response.text(), `${method} ${path}`).resolves.toBe("not found");
    }
  });

  it("signs an invited account back in by a code, into a cookie and nothing else", async () => {
    await signUpUser("grace@example.test");

    const signIn = await signInAs("grace@example.test");
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("set-auth-token")).toBeNull();
    const { token } = signInBodySchema.parse(await signIn.json());

    await expect(sessionOf({ authorization: `Bearer ${token}` })).resolves.toBeNull();
    const asCookie = await sessionOf({ cookie: cookieHeaderOf(signIn) });
    expect(asCookie?.user.email).toBe("grace@example.test");
  });
});

const windowAttempt = (inviteCode: string) => ({
  code: "123456",
  email: "window@example.test",
  inviteCode,
  name: "Window",
});

dbSuite("the invite gate's window", () => {
  it("closes on the eleventh attempt from one address, before it reads the code", async () => {
    const caller = { [CALLER_IP_HEADER]: "203.0.113.77" };

    for (let tried = 0; tried < 10; tried += 1) {
      const refused = await signUp(windowAttempt("NOT-A-CODE"), caller);
      expect(refused.status).toBe(403);
    }

    await mintCode("INVITE-WINDOW");
    const closed = await signUp(windowAttempt("INVITE-WINDOW"), caller);
    expect(closed.status).toBe(429);
    const untouched = await readCode("INVITE-WINDOW");
    expect(untouched?.redeemedAt).toBeNull();
  });
});
