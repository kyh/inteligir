import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";
import { z } from "zod";

import {
  authFetch,
  authPost,
  CALLER_IP_HEADER,
  cookieHeaderOf,
  mintCode,
  ORIGIN,
  PASSWORD,
  readCode,
  sessionOf,
  signUp,
} from "../test-support/auth-requests";

// Better Auth serves each of these, and no client calls one: a route by a name the door does not
// list, one whose path no exact list could name, and a listed route by a method no client sends
const UNLISTED_AUTH_ROUTES = [
  ["GET", "/list-sessions"],
  ["POST", "/delete-user"],
  ["GET", "/callback/x"],
  ["POST", "/get-session"],
] as const;

// what the sign-up form shows for a code that will not open an account, whatever the reason
const INVITE_REFUSED = "That invite code doesn't work.";

const signInBodySchema = z.looseObject({ token: z.string() });

const signInAs = async (email: string) =>
  await authPost("/sign-in/email", { origin: ORIGIN }, { email, password: PASSWORD });

dbSuite("invite-gated sign-up", () => {
  it("creates the account and burns the code", async () => {
    await mintCode("INVITE-OK");
    const response = await signUp({
      email: "ada@example.test",
      inviteCode: "INVITE-OK",
      name: "Ada",
      password: PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-auth-token")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBeNull();
    expect(response.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(true);

    const row = await readCode("INVITE-OK");
    expect(row?.redeemedBy).toBe("ada@example.test");
    expect(row?.redeemedAt).not.toBeNull();
  });

  it("refuses an unknown code without creating anything", async () => {
    const response = await signUp({
      email: "mallory@example.test",
      inviteCode: "NO-SUCH-CODE",
      name: "Mallory",
      password: PASSWORD,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ message: INVITE_REFUSED });

    const signIn = await signInAs("mallory@example.test");
    expect(signIn.status).not.toBe(200);
  });

  it("refuses a code that has already been redeemed", async () => {
    await mintCode("INVITE-ONCE");
    const first = await signUp({
      email: "first@example.test",
      inviteCode: "INVITE-ONCE",
      name: "First",
      password: PASSWORD,
    });
    expect(first.status).toBe(200);

    const second = await signUp({
      email: "second@example.test",
      inviteCode: "INVITE-ONCE",
      name: "Second",
      password: PASSWORD,
    });
    expect(second.status).toBe(403);
    await expect(second.json()).resolves.toStrictEqual({ message: INVITE_REFUSED });
    const claimed = await readCode("INVITE-ONCE");
    expect(claimed?.redeemedBy).toBe("first@example.test");
  });

  it("releases the claim when Better Auth rejects the sign-up", async () => {
    await mintCode("INVITE-TAKEN");
    await mintCode("INVITE-AGAIN");
    const taken = { email: "taken@example.test", name: "Taken", password: PASSWORD };
    const first = await signUp({ ...taken, inviteCode: "INVITE-TAKEN" });
    expect(first.status).toBe(200);

    const response = await signUp({ ...taken, inviteCode: "INVITE-AGAIN" });
    expect(response.status).not.toBe(200);

    const row = await readCode("INVITE-AGAIN");
    expect(row?.redeemedAt).toBeNull();
    expect(row?.redeemedBy).toBeNull();
  });

  it("refuses a password outside the contract's bounds before touching the invite", async () => {
    await mintCode("INVITE-BOUNDS");
    for (const password of [
      "x".repeat(PASSWORD_MIN_LENGTH - 1),
      "x".repeat(PASSWORD_MAX_LENGTH + 1),
    ]) {
      const response = await signUp({
        email: "bounds@example.test",
        inviteCode: "INVITE-BOUNDS",
        name: "Bounds",
        password,
      });
      expect(response.status, String(password.length)).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        message: `Use a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
      });
    }
    const untouched = await readCode("INVITE-BOUNDS");
    expect(untouched?.redeemedAt).toBeNull();
  });

  it("refuses a malformed body before touching the invite", async () => {
    await mintCode("INVITE-UNTOUCHED");
    const response = await signUp({ inviteCode: "INVITE-UNTOUCHED" });
    expect(response.status).toBe(400);
    const untouched = await readCode("INVITE-UNTOUCHED");
    expect(untouched?.redeemedAt).toBeNull();
  });

  it("refuses Better Auth's own sign-up route, which takes no code", async () => {
    const response = await authPost(
      "/sign-up/email",
      { origin: ORIGIN },
      { email: "eve@example.test", name: "Eve", password: PASSWORD },
    );
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not found");

    const signIn = await signInAs("eve@example.test");
    expect(signIn.status).not.toBe(200);
  });

  it("answers 404 on a Better Auth route no client calls, even to a signed-in browser", async () => {
    await mintCode("INVITE-SURFACE");
    const signedUp = await signUp({
      email: "surface@example.test",
      inviteCode: "INVITE-SURFACE",
      name: "Surface",
      password: PASSWORD,
    });
    expect(signedUp.status).toBe(200);
    const headers = { cookie: cookieHeaderOf(signedUp), origin: ORIGIN };

    for (const [method, path] of UNLISTED_AUTH_ROUTES) {
      const response = await authFetch(path, {
        body: method === "POST" ? "{}" : undefined,
        headers: { ...headers, "content-type": "application/json" },
        method,
      });
      expect(response.status, `${method} ${path}`).toBe(404);
      // the door's own answer, before Better Auth reads the request
      await expect(response.text(), `${method} ${path}`).resolves.toBe("not found");
    }
  });

  it("signs an invited account back in through Better Auth, into a cookie and nothing else", async () => {
    await mintCode("INVITE-RETURNS");
    const signedUp = await signUp({
      email: "grace@example.test",
      inviteCode: "INVITE-RETURNS",
      name: "Grace",
      password: PASSWORD,
    });
    expect(signedUp.status).toBe(200);

    const signIn = await signInAs("grace@example.test");
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("set-auth-token")).toBeNull();
    const { token } = signInBodySchema.parse(await signIn.json());

    await expect(sessionOf({ authorization: `Bearer ${token}` })).resolves.toBeNull();
    const asCookie = await sessionOf({ cookie: cookieHeaderOf(signIn) });
    expect(asCookie?.user.email).toBe("grace@example.test");
  });
});

const windowAttempt = (code: string) => ({
  email: "window@example.test",
  inviteCode: code,
  name: "Window",
  password: PASSWORD,
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
