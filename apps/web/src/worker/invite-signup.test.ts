import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/device/device-schema";
import { eq } from "drizzle-orm";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb } from "./db/client";
import { inviteCode } from "./db/schema";
import { CALLER_IP_HEADER } from "./rate-limit";
import { cookieHeaderOf, drained, OWN_PAGE_HEADERS } from "./test-support/cloud-helpers";

const ORIGIN = "https://inteligir-web.workers.dev";
const PASSWORD = "test-password-1234";

const UNUSED_AUTH_ROUTES = [
  ["GET", "/account-info"],
  ["POST", "/change-email"],
  ["POST", "/change-password"],
  ["POST", "/delete-user"],
  ["GET", "/delete-user/callback"],
  ["GET", "/error"],
  ["GET", "/expo-authorization-proxy"],
  ["POST", "/get-access-token"],
  ["POST", "/link-social"],
  ["GET", "/list-accounts"],
  ["GET", "/list-sessions"],
  ["GET", "/ok"],
  ["POST", "/refresh-token"],
  ["POST", "/revoke-other-sessions"],
  ["POST", "/revoke-session"],
  ["POST", "/revoke-sessions"],
  ["POST", "/send-verification-email"],
  ["POST", "/sign-in/social"],
  ["POST", "/unlink-account"],
  ["POST", "/update-session"],
  ["POST", "/update-user"],
  ["GET", "/verify-email"],
  ["POST", "/verify-password"],
] as const;

const signInBodySchema = z.looseObject({ token: z.string() });
const sessionSchema = z.looseObject({ user: z.looseObject({ email: z.string() }) });

const mintCode = async (code: string): Promise<void> => {
  await createDb(env.DB).insert(inviteCode).values({ code });
};

const signUp = async (
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await exports.default.fetch(`${ORIGIN}${AUTH_API_PATHS.signUp}`, {
    body: JSON.stringify(body),
    headers: { ...OWN_PAGE_HEADERS, ...headers, "content-type": "application/json" },
    method: "POST",
  });

const readCode = async (code: string) =>
  await createDb(env.DB).select().from(inviteCode).where(eq(inviteCode.code, code)).get();

describe("invite-gated sign-up", () => {
  it("creates the account and burns the code", async () => {
    await mintCode("INVITE-OK");
    const response = await drained(
      signUp({
        email: "ada@example.test",
        inviteCode: "INVITE-OK",
        name: "Ada",
        password: PASSWORD,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-auth-token")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBeNull();
    expect(response.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(true);

    const row = await readCode("INVITE-OK");
    expect(row?.redeemedBy).toBe("ada@example.test");
    expect(row?.redeemedAt).not.toBeNull();
  });

  it("refuses an unknown code without creating anything", async () => {
    const response = await drained(
      signUp({
        email: "mallory@example.test",
        inviteCode: "NO-SUCH-CODE",
        name: "Mallory",
        password: PASSWORD,
      }),
    );
    expect(response.status).toBe(403);

    const signIn = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
        body: JSON.stringify({ email: "mallory@example.test", password: PASSWORD }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      }),
    );
    expect(signIn.status).not.toBe(200);
  });

  it("refuses a code that has already been redeemed", async () => {
    await mintCode("INVITE-ONCE");
    const first = await drained(
      signUp({
        email: "first@example.test",
        inviteCode: "INVITE-ONCE",
        name: "First",
        password: PASSWORD,
      }),
    );
    expect(first.status).toBe(200);

    const second = await drained(
      signUp({
        email: "second@example.test",
        inviteCode: "INVITE-ONCE",
        name: "Second",
        password: PASSWORD,
      }),
    );
    expect(second.status).toBe(403);
    const claimed = await readCode("INVITE-ONCE");
    expect(claimed?.redeemedBy).toBe("first@example.test");
  });

  it("releases the claim when Better Auth rejects the sign-up", async () => {
    await mintCode("INVITE-TAKEN");
    await mintCode("INVITE-AGAIN");
    const taken = { email: "taken@example.test", name: "Taken", password: PASSWORD };
    const first = await drained(signUp({ ...taken, inviteCode: "INVITE-TAKEN" }));
    expect(first.status).toBe(200);

    const response = await drained(signUp({ ...taken, inviteCode: "INVITE-AGAIN" }));
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
    const response = await drained(signUp({ inviteCode: "INVITE-UNTOUCHED" }));
    expect(response.status).toBe(400);
    const untouched = await readCode("INVITE-UNTOUCHED");
    expect(untouched?.redeemedAt).toBeNull();
  });

  it("refuses Better Auth's own sign-up route, which takes no code", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "eve@example.test",
        name: "Eve",
        password: PASSWORD,
      }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    });

    const signIn = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
        body: JSON.stringify({ email: "eve@example.test", password: PASSWORD }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      }),
    );
    expect(signIn.status).not.toBe(200);
  });

  it("answers 404 on each Better Auth route no client calls, even to a signed-in browser", async () => {
    await mintCode("INVITE-SURFACE");
    const signedUp = await drained(
      signUp({
        email: "surface@example.test",
        inviteCode: "INVITE-SURFACE",
        name: "Surface",
        password: PASSWORD,
      }),
    );
    expect(signedUp.status).toBe(200);
    const headers = { cookie: cookieHeaderOf(signedUp), origin: ORIGIN };

    for (const [method, path] of UNUSED_AUTH_ROUTES) {
      const response = await drained(
        exports.default.fetch(`${ORIGIN}/api/auth${path}`, {
          body: method === "POST" ? "{}" : null,
          headers: { ...headers, "content-type": "application/json" },
          method,
        }),
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it("signs an invited account back in through Better Auth, into a cookie and nothing else", async () => {
    await mintCode("INVITE-RETURNS");
    const signedUp = await drained(
      signUp({
        email: "grace@example.test",
        inviteCode: "INVITE-RETURNS",
        name: "Grace",
        password: PASSWORD,
      }),
    );
    expect(signedUp.status).toBe(200);

    const signIn = await exports.default.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: "grace@example.test", password: PASSWORD }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("set-auth-token")).toBeNull();
    const { token } = signInBodySchema.parse(await signIn.json());

    const asBearer = await exports.default.fetch(`${ORIGIN}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await expect(asBearer.json()).resolves.toBeNull();
    const asCookie = await exports.default.fetch(`${ORIGIN}/api/auth/get-session`, {
      headers: { cookie: cookieHeaderOf(signIn) },
    });
    expect(sessionSchema.parse(await asCookie.json()).user.email).toBe("grace@example.test");
  });
});

const windowAttempt = (code: string) => ({
  email: "window@example.test",
  inviteCode: code,
  name: "Window",
  password: PASSWORD,
});

describe("the invite gate's window", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("closes on the eleventh attempt from one address, before it reads the code", async () => {
    const caller = { [CALLER_IP_HEADER]: "203.0.113.77" };
    for (let tried = 0; tried < 10; tried += 1) {
      const refused = await drained(signUp(windowAttempt("NOT-A-CODE"), caller));
      expect(refused.status).toBe(403);
    }
    await mintCode("INVITE-WINDOW");
    const closed = await drained(signUp(windowAttempt("INVITE-WINDOW"), caller));
    expect(closed.status).toBe(429);
    const untouched = await readCode("INVITE-WINDOW");
    expect(untouched?.redeemedAt).toBeNull();
  });
});
