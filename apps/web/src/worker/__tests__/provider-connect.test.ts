// ---------------------------------------------------------------------------
// The provider connect round-trip, end to end minus the provider.
//
// The flow spans three modules and a browser redirect: a Bridge handler mints
// the consent URL, the user leaves, and an unauthenticated GET comes back
// carrying the only credential involved — the signed `state`. Nothing in the
// middle is a session, so every guard is on that token and on the verifier the
// start parked.
//
// What is stubbed here is the PROVIDER and nothing else: `ProviderCredentials`
// takes its `fetch` injected, so the token exchange runs its real code against
// a scripted token endpoint. The authorize URL, the state token, the PKCE
// challenge, the pending record, the sealing and the client push are all the
// production ones.
// ---------------------------------------------------------------------------

import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { verifyScopedToken } from "../agent/agent-crypto";
import { routeOAuthCallback } from "../agent/agent-route";
import { chooseProvider, type ProviderEnv } from "../agent/provider-catalog";
import { ProviderCredentials } from "../agent/provider-credentials";
import { OAUTH_CALLBACK_PATH, startAuthorization } from "../agent/provider-oauth";
import { handleOAuthCallback } from "../host/agent-endpoints";
import type { DeletableDurableKv } from "../store/durable-kv";

const ORIGIN = "https://inteligir.test";
const USER = "connect-user";

/** The OAuth trio vitest.config.ts binds, spelled as the narrow shape the
 * catalog reads. `Env` cannot stand in: these are production SECRETS, so
 * `wrangler types` never declares them and the two types share no property. */
const CONFIGURED: ProviderEnv = {
  ANTHROPIC_OAUTH_AUTHORIZE_URL: "https://provider.test/authorize",
  ANTHROPIC_OAUTH_TOKEN_URL: "https://provider.test/token",
  ANTHROPIC_OAUTH_CLIENT_ID: "test-client",
};

/** An in-memory stand-in for `ctx.storage.kv` — the same synchronous contract. */
function memoryKv(): DeletableDurableKv {
  const entries = new Map<string, unknown>();
  return {
    get: (key) => entries.get(key),
    put: (key, value) => {
      entries.set(key, value);
    },
    delete: (key) => entries.delete(key),
  };
}

function credentialsWith(tokenResponse: () => Response): ProviderCredentials {
  return new ProviderCredentials({
    kv: memoryKv(),
    userId: USER,
    secret: env.BETTER_AUTH_SECRET,
    env,
    fetch: async () => tokenResponse(),
  });
}

const grant = (): Response =>
  Response.json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 });

/** Start an authorization for real and park its verifier, returning the state
 * the provider would echo back. */
async function begin(credentials: ProviderCredentials): Promise<{ state: string; url: URL }> {
  const started = await startAuthorization(env, USER, "anthropic", ORIGIN);
  if ("error" in started) throw new Error(started.error);
  credentials.putPending(started.pending);
  const url = new URL(started.authorizeUrl);
  const state = url.searchParams.get("state");
  if (state === null) throw new Error("the authorize URL carried no state");
  return { state, url };
}

function callback(params: Record<string, string>): Request {
  const url = new URL(`${ORIGIN}${OAUTH_CALLBACK_PATH}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url, { method: "GET" });
}

describe("starting an authorization", () => {
  it("answers with a consent URL the client can actually send a user to", async () => {
    const { url, state } = await begin(credentialsWith(grant));

    expect(url.origin + url.pathname).toBe("https://provider.test/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    // Byte-for-byte what the provider's app must have registered.
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}${OAUTH_CALLBACK_PATH}`);
    expect(url.searchParams.get("scope")).toBe("user:inference");
    // PKCE: the challenge travels, the verifier never does.
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.toString()).not.toContain("code_verifier");

    // The state is the credential the callback is checked against, so it has to
    // be this deployment's, scoped to oauth, and naming this user.
    const claims = await verifyScopedToken(env.BETTER_AUTH_SECRET, "oauth", state, Date.now());
    expect(claims).toMatchObject({ userId: USER });
  });

  it("refuses a provider this deployment configured no OAuth app for", async () => {
    // OPENAI_* is unset in the test env, so there is no app to authorize
    // against — a VALUE the client renders, never a throw.
    expect(await startAuthorization(env, USER, "openai", ORIGIN)).toEqual({
      error: expect.stringContaining("not configured on this deployment"),
    });
  });

  it("refuses a provider with nothing to connect to, and one that does not exist", async () => {
    expect(await startAuthorization(env, USER, "sandbox", ORIGIN)).toEqual({
      error: expect.stringContaining("needs no connection"),
    });
    expect(await startAuthorization(env, USER, "nosuch", ORIGIN)).toEqual({
      error: expect.stringContaining("no provider called nosuch"),
    });
  });
});

describe("completing it on the callback", () => {
  it("exchanges the code, seals the grant, and tells the workspace", async () => {
    const credentials = credentialsWith(grant);
    const { state } = await begin(credentials);
    const settled = vi.fn();

    const response = await handleOAuthCallback(
      callback({ state, code: "auth-code" }),
      env,
      credentials,
      settled,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("You can close this tab");
    expect(credentials.connected("anthropic")).toBe(true);
    // The workspace is in another tab with nothing else to learn from.
    expect(settled).toHaveBeenCalledTimes(1);
  });

  // The state every connected account starts in, and the one the chat's
  // Re-authenticate link must not refuse from: completing an authorization
  // seals the credential and writes no selection, so an account that never
  // opened the model dropdown has `null` there forever.
  it("stores no selection, and the one resolution still names what was connected", async () => {
    const credentials = credentialsWith(grant);
    const { state } = await begin(credentials);
    await handleOAuthCallback(callback({ state, code: "auth-code" }), env, credentials, vi.fn());

    expect(credentials.selection()).toBeNull();
    expect(
      chooseProvider(CONFIGURED, credentials.selection(), (provider) =>
        credentials.connected(provider),
      ),
    ).toMatchObject({ ok: true, entry: { id: "anthropic" } });
  });

  it("refuses a replay — the verifier is consumed on read", async () => {
    const credentials = credentialsWith(grant);
    const { state } = await begin(credentials);
    await handleOAuthCallback(callback({ state, code: "auth-code" }), env, credentials, vi.fn());

    const settled = vi.fn();
    const replay = await handleOAuthCallback(
      callback({ state, code: "auth-code" }),
      env,
      credentials,
      settled,
    );
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("already completed");
    // Nothing was spent, so there is nothing to settle a client about.
    expect(settled).not.toHaveBeenCalled();
  });

  it("names a declined consent, clears the attempt, and settles the workspace", async () => {
    const credentials = credentialsWith(grant);
    const { state } = await begin(credentials);
    const settled = vi.fn();

    const response = await handleOAuthCallback(
      callback({ state, error: "access_denied" }),
      env,
      credentials,
      settled,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("You declined the connection");
    expect(credentials.connected("anthropic")).toBe(false);
    // The whole point: a client stuck on "waiting" is the failure this path had.
    expect(settled).toHaveBeenCalledTimes(1);
    // And the parked verifier is gone, so the refusal cannot be replayed into a
    // grant with a code someone else supplies.
    expect(credentials.takePending("anything")).toBeNull();
  });

  it("surfaces a token endpoint that refuses, without storing anything", async () => {
    const credentials = credentialsWith(() => new Response("nope", { status: 401 }));
    const { state } = await begin(credentials);
    const settled = vi.fn();

    const response = await handleOAuthCallback(
      callback({ state, code: "auth-code" }),
      env,
      credentials,
      settled,
    );

    expect(await response.text()).toContain("refused the token request (401)");
    expect(credentials.connected("anthropic")).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("refuses a state this deployment did not sign, and one that expired", async () => {
    const credentials = credentialsWith(grant);
    await begin(credentials);
    const settled = vi.fn();

    const forged = await handleOAuthCallback(
      callback({ state: "not.a.real.token", code: "auth-code" }),
      env,
      credentials,
      settled,
    );
    expect(await forged.text()).toContain("expired");

    const bare = await handleOAuthCallback(
      callback({ code: "auth-code" }),
      env,
      credentials,
      settled,
    );
    expect(await bare.text()).toContain("missing something");

    expect(settled).not.toHaveBeenCalled();
    expect(credentials.connected("anthropic")).toBe(false);
  });
});

describe("routing the redirect", () => {
  it("addresses the object the state names, refusal included", async () => {
    const started = await startAuthorization(env, USER, "anthropic", ORIGIN);
    if ("error" in started) throw new Error(started.error);
    const state = new URL(started.authorizeUrl).searchParams.get("state") ?? "";

    // No verifier is parked in the addressed object (this one started nothing),
    // so it answers "already completed, or has expired" — which proves the
    // request reached an object rather than being answered by the route.
    for (const params of [
      { state, code: "c" },
      { state, error: "access_denied" },
    ]) {
      const response = await routeOAuthCallback(callback(params), env, OAUTH_CALLBACK_PATH);
      expect(response).not.toBeNull();
      expect(await response?.text()).toContain("already completed");
    }
  });

  it("answers what it cannot address, and only what it cannot", async () => {
    const refused = await routeOAuthCallback(
      callback({ error: "access_denied" }),
      env,
      OAUTH_CALLBACK_PATH,
    );
    expect(await refused?.text()).toContain("You declined the connection");

    const stray = await routeOAuthCallback(callback({ code: "c" }), env, OAUTH_CALLBACK_PATH);
    expect(await stray?.text()).toContain("not issued by this app");

    expect(await routeOAuthCallback(callback({}), env, "/v1/something-else")).toBeNull();
  });
});
