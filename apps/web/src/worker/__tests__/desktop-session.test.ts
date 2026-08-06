import { formatBearer, manifestPath } from "@repo/notes/sync/wire";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { desktopAuthCode } from "../db/schema";
import { sha256Hex } from "../hash";

// The desktop social-login handoff (src/worker/auth/desktop-session.ts), driven
// against the real in-process Worker + D1. A real provider consent can't run
// here, but the flow AFTER consent is provider-agnostic: Better Auth sets a
// session cookie and redirects the browser to /v1/auth/desktop-callback — so
// an email sign-up's session cookie exercises the exact same callback → mint
// → exchange → bearer path the OAuth callback produces.
const ORIGIN = "https://inteligir-web.workers.dev";
const STATE = "desktop-minted-state_0000000000";

/** Sign a fresh user up and return the SESSION COOKIE pair (`name=value`) the
 * response set — the credential the browser carries into the callback. */
async function signUpWithCookie(email: string): Promise<string> {
  const response = await SELF.fetch(ORIGIN + "/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: "test-password-1234", name: "user" }),
  });
  if (response.status !== 200) {
    throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
  }
  const sessionCookie = response.headers
    .getSetCookie()
    .find((cookie) => cookie.includes("session_token="));
  if (sessionCookie === undefined) throw new Error("no session cookie on sign-up");
  const pair = sessionCookie.split(";")[0];
  if (pair === undefined || pair === "") throw new Error("malformed session cookie");
  return pair;
}

function desktopCallback(cookie: string | null, state: string | null): Promise<Response> {
  const query = state === null ? "" : `?state=${state}`;
  return SELF.fetch(ORIGIN + "/v1/auth/desktop-callback" + query, {
    headers: cookie === null ? {} : { cookie },
  });
}

/** Pull the minted code out of the interstitial's deep link. */
function extractDeepLink(html: string): { code: string; state: string } | null {
  const match = /inteligir:\/\/session\?code=([A-Za-z0-9_-]+)&state=([A-Za-z0-9_-]+)/.exec(html);
  return match !== null && match[1] !== undefined && match[2] !== undefined
    ? { code: match[1], state: match[2] }
    : null;
}

async function exchange(code: string): Promise<{ status: number; body: unknown }> {
  const response = await SELF.fetch(ORIGIN + "/v1/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return { status: response.status, body: await response.json() };
}

describe("desktop social-login handoff", () => {
  it("callback mints a code; exchange returns a bearer that works on the sync routes", async () => {
    const cookie = await signUpWithCookie("handoff@example.com");
    const callback = await desktopCallback(cookie, STATE);
    expect(callback.status).toBe(200);
    // The page embeds a one-time code — it must never be cacheable.
    expect(callback.headers.get("cache-control")).toBe("no-store");

    const html = await callback.text();
    const link = extractDeepLink(html);
    expect(link).not.toBeNull();
    if (link === null) throw new Error("unreachable");
    // The desktop's state nonce is echoed through untouched.
    expect(link.state).toBe(STATE);
    // High-entropy opaque code (32 bytes → 43 base64url chars)…
    expect(link.code).toHaveLength(43);
    // …and NO raw session/bearer token anywhere in the deep link or the page:
    // the only credential-shaped strings must be the code itself.
    expect(html).not.toContain("token");

    const { status, body } = await exchange(link.code);
    expect(status).toBe(200);
    const exchanged = body;
    if (typeof exchanged !== "object" || exchanged === null) throw new Error("non-object body");
    expect(exchanged).toMatchObject({ ok: true, email: "handoff@example.com" });
    const token = "token" in exchanged ? exchanged.token : null;
    if (typeof token !== "string") throw new Error("no token in exchange body");

    // The exchanged bearer is a REAL session credential: it authenticates a
    // sync route (the same adoption path email sign-in's token takes).
    const manifest = await SELF.fetch(ORIGIN + manifestPath("vault-handoff"), {
      headers: { authorization: formatBearer(token) },
    });
    expect(manifest.status).toBe(200);
  });

  it("a code is SINGLE-USE — the second exchange fails", async () => {
    const cookie = await signUpWithCookie("single-use@example.com");
    const html = await (await desktopCallback(cookie, STATE)).text();
    const link = extractDeepLink(html);
    if (link === null) throw new Error("no code minted");

    const first = await exchange(link.code);
    expect(first.body).toMatchObject({ ok: true });
    const second = await exchange(link.code);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: false });
  });

  it("an EXPIRED code is rejected", async () => {
    const db = createDb(env.DB);
    const code = "expired-code-expired-code-expired-code-0000";
    await db.insert(desktopAuthCode).values({
      codeHash: await sha256Hex(new TextEncoder().encode(code)),
      token: "stale-token",
      email: "stale@example.com",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const { body } = await exchange(code);
    expect(body).toMatchObject({ ok: false });
    // The burn removed the row even though it was already dead.
    const remaining = await db.select().from(desktopAuthCode).all();
    expect(remaining.filter((row) => row.token === "stale-token")).toHaveLength(0);
  });

  it("bad and malformed codes are rejected as values", async () => {
    const unknown = await exchange("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(unknown.status).toBe(200);
    expect(unknown.body).toMatchObject({ ok: false });

    // Outside the opaque grammar (charset / length) — rejected before any DB hit.
    expect((await exchange("short")).body).toMatchObject({ ok: false });
    expect((await exchange("has spaces and $ymbols — not a code")).body).toMatchObject({
      ok: false,
    });

    // Malformed body entirely.
    const malformed = await SELF.fetch(ORIGIN + "/v1/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toMatchObject({ ok: false });
  });

  it("callback WITHOUT a session mints nothing", async () => {
    const response = await desktopCallback(null, STATE);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(extractDeepLink(html)).toBeNull();
  });

  it("callback WITHOUT a desktop state mints nothing (even with a session)", async () => {
    const cookie = await signUpWithCookie("stateless@example.com");
    const missing = await desktopCallback(cookie, null);
    expect(missing.status).toBe(400);
    expect(extractDeepLink(await missing.text())).toBeNull();

    // A state outside the opaque grammar is refused too — it would otherwise
    // be reflected into the interstitial's URL.
    const junk = await desktopCallback(cookie, "%3Cscript%3E");
    expect(junk.status).toBe(400);
    expect(extractDeepLink(await junk.text())).toBeNull();
  });
});
