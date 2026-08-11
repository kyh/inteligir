import { eq } from "drizzle-orm";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

// The invite gate in front of sign-up (src/worker/auth/invite.ts), driven
// against the real in-process Worker + D1. Everything here is the production
// path: the claim is a real D1 statement and the account is created by Better
// Auth's own handler, reached through the forward.
const ORIGIN = "https://inteligir-web.workers.dev";
const PASSWORD = "test-password-1234";

async function mintCode(code: string): Promise<void> {
  await createDb(env.DB).insert(inviteCode).values({ code });
}

function signUp(body: Record<string, string>): Promise<Response> {
  return SELF.fetch(ORIGIN + "/v1/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

function readCode(code: string) {
  return createDb(env.DB).select().from(inviteCode).where(eq(inviteCode.code, code)).get();
}

describe("invite-gated sign-up", () => {
  it("creates the account and burns the code", async () => {
    await mintCode("INVITE-OK");
    const response = await signUp({
      name: "Ada",
      email: "ada@example.test",
      password: PASSWORD,
      inviteCode: "INVITE-OK",
    });

    expect(response.status).toBe(200);
    // Better Auth's own response, forwarded untouched: the session credential
    // both a browser (cookie) and a non-browser client (bearer) need.
    expect(response.headers.get("set-auth-token")).not.toBeNull();
    expect(response.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(true);

    const row = await readCode("INVITE-OK");
    expect(row?.redeemedBy).toBe("ada@example.test");
    expect(row?.redeemedAt).not.toBeNull();
  });

  it("refuses an unknown code without creating anything", async () => {
    const response = await signUp({
      name: "Mallory",
      email: "mallory@example.test",
      password: PASSWORD,
      inviteCode: "NO-SUCH-CODE",
    });
    expect(response.status).toBe(403);

    const signIn = await SELF.fetch(ORIGIN + "/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "mallory@example.test", password: PASSWORD }),
    });
    expect(signIn.status).not.toBe(200);
  });

  it("refuses a code that has already been redeemed", async () => {
    await mintCode("INVITE-ONCE");
    const first = await signUp({
      name: "First",
      email: "first@example.test",
      password: PASSWORD,
      inviteCode: "INVITE-ONCE",
    });
    expect(first.status).toBe(200);

    const second = await signUp({
      name: "Second",
      email: "second@example.test",
      password: PASSWORD,
      inviteCode: "INVITE-ONCE",
    });
    expect(second.status).toBe(403);
    // Still the first redeemer's — a loser never rewrites the winner's claim.
    expect((await readCode("INVITE-ONCE"))?.redeemedBy).toBe("first@example.test");
  });

  it("releases the claim when Better Auth rejects the sign-up", async () => {
    await mintCode("INVITE-WEAK");
    const response = await signUp({
      name: "Short",
      email: "short@example.test",
      password: "abc",
      inviteCode: "INVITE-WEAK",
    });
    expect(response.status).not.toBe(200);

    const row = await readCode("INVITE-WEAK");
    expect(row?.redeemedAt).toBeNull();
    expect(row?.redeemedBy).toBeNull();
  });

  it("refuses a malformed body before touching the invite", async () => {
    await mintCode("INVITE-UNTOUCHED");
    const response = await signUp({ inviteCode: "INVITE-UNTOUCHED" });
    expect(response.status).toBe(400);
    expect((await readCode("INVITE-UNTOUCHED"))?.redeemedAt).toBeNull();
  });

  // The gate is only a gate if there is no way past it. Better Auth's own
  // sign-up route is reachable on this origin and takes no invite field, so
  // without `disableSignUp` on the instance that serves `/api/auth/*` it
  // creates an account for anyone who types the path.
  it("refuses Better Auth's own sign-up route, which takes no code", async () => {
    const response = await SELF.fetch(ORIGIN + "/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        name: "Eve",
        email: "eve@example.test",
        password: PASSWORD,
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });

    // Refused, not merely unacknowledged: no account came out of it.
    const signIn = await SELF.fetch(ORIGIN + "/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "eve@example.test", password: PASSWORD }),
    });
    expect(signIn.status).not.toBe(200);
  });

  // The other door into sign-up, and the one no route table shows: an OAuth
  // callback creates an account from the provider's profile, having asked no
  // code. Asserted over the built config rather than by driving a callback,
  // because the provider is the party that would have to answer — and the flag
  // is the whole of what Better Auth reads (`provider.options.disableSignUp`).
  it("refuses account creation through every social provider it can serve", () => {
    const configured = createAuth(
      {
        ...env,
        GITHUB_CLIENT_ID: "gh-id",
        GITHUB_CLIENT_SECRET: "gh-secret",
        GOOGLE_CLIENT_ID: "goo-id",
        GOOGLE_CLIENT_SECRET: "goo-secret",
      },
      ORIGIN,
    );

    const social = configured.options.socialProviders ?? {};
    expect(Object.keys(social).toSorted()).toEqual(["github", "google"]);
    for (const [name, provider] of Object.entries(social)) {
      expect(
        provider?.disableSignUp,
        `${name} may sign a linked account in, never create one`,
      ).toBe(true);
    }
  });

  // Sign-IN is untouched by the flag — the same instance still serves it, and
  // an account that spent a code has to be able to come back.
  it("still signs an invited account back in through Better Auth", async () => {
    await mintCode("INVITE-RETURNS");
    expect(
      (
        await signUp({
          name: "Grace",
          email: "grace@example.test",
          password: PASSWORD,
          inviteCode: "INVITE-RETURNS",
        })
      ).status,
    ).toBe(200);

    const signIn = await SELF.fetch(ORIGIN + "/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "grace@example.test", password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);
  });
});
