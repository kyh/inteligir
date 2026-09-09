// oxlint-disable typescript/no-deprecated -- SELF is the only fetcher that runs in the tests'
// own isolate; the cloudflare:workers loopback binding stands a second worker up, and its
// first fetch costs seconds enough to time a test out.
import { eq } from "drizzle-orm";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

const ORIGIN = "https://inteligir-web.workers.dev";
const PASSWORD = "test-password-1234";

const mintCode = async (code: string): Promise<void> => {
  await createDb(env.DB).insert(inviteCode).values({ code });
};

const signUp = async (body: Record<string, string>): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}/v1/auth/sign-up`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: ORIGIN },
    method: "POST",
  });

const readCode = async (code: string) =>
  await createDb(env.DB).select().from(inviteCode).where(eq(inviteCode.code, code)).get();

describe("invite-gated sign-up", () => {
  it("creates the account and burns the code", async () => {
    await mintCode("INVITE-OK");
    const response = await signUp({
      email: "ada@example.test",
      inviteCode: "INVITE-OK",
      name: "Ada",
      password: PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-auth-token")).not.toBeNull();
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

    const signIn = await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: "mallory@example.test", password: PASSWORD }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    });
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
    const claimed = await readCode("INVITE-ONCE");
    expect(claimed?.redeemedBy).toBe("first@example.test");
  });

  it("releases the claim when Better Auth rejects the sign-up", async () => {
    await mintCode("INVITE-WEAK");
    const response = await signUp({
      email: "short@example.test",
      inviteCode: "INVITE-WEAK",
      name: "Short",
      password: "abc",
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
    const untouched = await readCode("INVITE-UNTOUCHED");
    expect(untouched?.redeemedAt).toBeNull();
  });

  it("refuses Better Auth's own sign-up route, which takes no code", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "eve@example.test",
        name: "Eve",
        password: PASSWORD,
      }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });

    const signIn = await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: "eve@example.test", password: PASSWORD }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    });
    expect(signIn.status).not.toBe(200);
  });

  it("still signs an invited account back in through Better Auth", async () => {
    await mintCode("INVITE-RETURNS");
    const signedUp = await signUp({
      email: "grace@example.test",
      inviteCode: "INVITE-RETURNS",
      name: "Grace",
      password: PASSWORD,
    });
    expect(signedUp.status).toBe(200);

    const signIn = await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: "grace@example.test", password: PASSWORD }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    });
    expect(signIn.status).toBe(200);
  });
});
