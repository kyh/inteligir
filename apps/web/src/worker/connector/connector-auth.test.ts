// The connector's OAuth as an assistant meets it: the challenge and the two metadata documents it
// discovers the authorization server by, registration, the consent page with PKCE, the code it
// trades for a token minted for this connector alone, and the account's list and revoke.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { V1_RPC_PATH } from "@repo/contract/v1";
import type { V1Client } from "@repo/contract/v1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDb } from "../db/client";
import { connectorAuth, isConnectorPath } from "./connector-auth";
import { rateLimit, session } from "../db/schema";
import { CALLER_IP_HEADER, callerRateKey, grantRateKey } from "../rate-limit";
import {
  drained,
  ORIGIN,
  sessionHeaders,
  sessionTokenOf,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import {
  answerConsent,
  authorizeUrl,
  connectAssistant,
  CONNECTOR_URL,
  exchangeCode,
  registerClient,
  registration,
  showConsent,
  workerFetch,
} from "../test-support/connector-session";
import { pkcePair } from "../test-support/pkce";

// an MCP request any client opens with, here sent bare to see what answers it
const initialize = async (headers: Record<string, string> = {}) =>
  await workerFetch(CONNECTOR_URL, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "probe", version: "1" },
        protocolVersion: "2025-06-18",
      },
    }),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });

// a client renewing its access at the token endpoint
const refresh = async (clientId: string, refreshToken: string): Promise<Response> =>
  await workerFetch(`${ORIGIN}/oauth/token`, {
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    method: "POST",
  });

// the account's procedures as the library's own tab calls them, on its session cookie
const accountClient = (cookie: string): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await workerFetch(url, init),
      headers: sessionHeaders(cookie),
      origin: ORIGIN,
      url: V1_RPC_PATH,
    }),
  );

describe("the connector's sign-in", () => {
  it("challenges a call with no token, naming the metadata that names this deployment its issuer", async () => {
    const refused = await drained(initialize());
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/connector"`,
    );
    expect(refused.headers.get("www-authenticate")).toContain('scope="library:read"');

    const resource = await workerFetch(`${ORIGIN}/.well-known/oauth-protected-resource/connector`);
    await expect(resource.json()).resolves.toStrictEqual({
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ["header"],
      resource: CONNECTOR_URL,
      resource_name: "Inteligir library",
      scopes_supported: ["library:read"],
    });

    const server = await workerFetch(`${ORIGIN}/.well-known/oauth-authorization-server`);
    await expect(server.json()).resolves.toMatchObject({
      authorization_endpoint: `${ORIGIN}/connect/authorize`,
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      issuer: ORIGIN,
      protected_resources: [CONNECTOR_URL],
      registration_endpoint: `${ORIGIN}/oauth/register`,
      scopes_supported: ["library", "library:read"],
      token_endpoint: `${ORIGIN}/oauth/token`,
    });
  });

  it("refuses a request from another site's page, or for another host, before it reads a token", async () => {
    const foreign = await drained(initialize({ origin: "https://elsewhere.example" }));
    expect(foreign.status).toBe(403);
    const rebound = await drained(initialize({ host: "attacker.example" }));
    expect(rebound.status).toBe(403);
  });

  it("owns its own path and its metadata, and nothing under either", () => {
    expect(isConnectorPath(CONNECTOR_PATH)).toBe(true);
    expect(isConnectorPath(`/.well-known/oauth-protected-resource${CONNECTOR_PATH}`)).toBe(true);
    expect(isConnectorPath(`${CONNECTOR_PATH}/`)).toBe(false);
    expect(isConnectorPath(`${CONNECTOR_PATH}/anything`)).toBe(false);
  });

  it("takes no app's session: the connector is an assistant's door alone", async () => {
    const { cookie } = await signUpUser("connector-device@example.test");
    const signed = decodeURIComponent(sessionTokenOf(cookie));
    const [token = ""] = signed.split(".");
    for (const bearer of [signed, token]) {
      const refused = await drained(initialize({ authorization: `Bearer ${bearer}` }));
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
    const byCookie = await drained(initialize({ cookie }));
    expect(byCookie.status).toBe(401);
  });

  it("sends a person who is not signed in to sign in, and back to the page", async () => {
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    const url = authorizeUrl(clientId, challenge);
    const response = await drained(workerFetch(url, { redirect: "manual" }));
    expect(response.status).toBe(302);
    const signIn = new URL(response.headers.get("location") ?? "");
    expect(signIn.pathname).toBe("/app/sign-in");
    const back = new URL(url);
    expect(signIn.searchParams.get("next")).toBe(`${back.pathname}${back.search}`);
  });

  it("asks the signed-in person in their words, with what the client claims escaped and the page unframeable", async () => {
    const { cookie } = await signUpUser("connector-escape@example.test");
    const clientId = await registerClient('<img src=x onerror="alert(1)">');
    const { challenge } = await pkcePair();
    const shown = await showConsent(cookie, authorizeUrl(clientId, challenge));
    expect(shown.html).toContain("to read and change your library?");
    expect(shown.html).toContain("&#60;img src=x onerror=&#34;alert(1)&#34;&#62;");
    expect(shown.html).not.toContain("<img");
    expect(shown.html).toContain("connector-escape@example.test");
    expect(shown.html).toContain("Disconnect it in Settings › Account › Connected assistants");
    expect(shown.html).not.toContain("30 days");
    // the redirect goes to an app on this machine, which the page warns of
    expect(shown.html).toContain("This sends access to an app on this computer.");
    expect(shown.response.headers.get("x-frame-options")).toBe("DENY");
    expect(shown.response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(shown.response.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves a session due to slide as it found it, having no cookie to send with it", async () => {
    const { cookie } = await signUpUser("connector-slide@example.test");
    const userId = await userIdOf(cookie);
    const db = createDb(env.DB);
    const due = new Date(Date.now() + 5 * 86_400_000);
    await db.update(session).set({ expiresAt: due }).where(eq(session.userId, userId));

    const { challenge } = await pkcePair();
    await showConsent(cookie, authorizeUrl(await registerClient(), challenge));

    const row = await db
      .select({ expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.userId, userId))
      .get();
    expect(row?.expiresAt.getTime()).toBe(due.getTime());
  });

  it("hands the client a code bound to its challenge, and a token minted for this connector alone", async () => {
    const { cookie } = await signUpUser("connector-allow@example.test");
    const clientId = await registerClient();
    const { challenge, verifier } = await pkcePair();
    const url = authorizeUrl(clientId, challenge, "state-1");
    const redirect = await answerConsent(url, await showConsent(cookie, url), {
      decision: "allow",
    });
    expect(`${redirect.origin}${redirect.pathname}`).toBe("http://127.0.0.1:43123/callback");
    expect(redirect.searchParams.get("state")).toBe("state-1");
    // RFC 9207: the response names its issuer
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);
    const code = redirect.searchParams.get("code") ?? "";

    // the wrong verifier trades nothing
    const other = await pkcePair();
    const wrong = await workerFetch(`${ORIGIN}/oauth/token`, {
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: other.verifier,
        grant_type: "authorization_code",
        redirect_uri: "http://127.0.0.1:43123/callback",
      }),
      method: "POST",
    });
    await expect(wrong.json()).resolves.toMatchObject({ error: "invalid_grant" });

    const minted = await workerFetch(`${ORIGIN}/oauth/token`, {
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: "http://127.0.0.1:43123/callback",
        resource: CONNECTOR_URL,
      }),
      method: "POST",
    });
    // the person allowed reading and changing, more than the client first asked for
    await expect(minted.json()).resolves.toMatchObject({
      resource: CONNECTOR_URL,
      scope: "library",
      token_type: "bearer",
    });
  });

  it("answers a person who does not allow it with access_denied, the client's state and the issuer", async () => {
    const { cookie } = await signUpUser("connector-deny@example.test");
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    const url = authorizeUrl(clientId, challenge, "state-2");
    const redirect = await answerConsent(url, await showConsent(cookie, url), {
      decision: "deny",
    });
    expect(Object.fromEntries(redirect.searchParams)).toMatchObject({
      error: "access_denied",
      iss: ORIGIN,
      state: "state-2",
    });
  });

  it("refuses a form posted twice, as a page already answered", async () => {
    const { cookie } = await signUpUser("connector-twice@example.test");
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    const url = authorizeUrl(clientId, challenge);
    const shown = await showConsent(cookie, url);
    await answerConsent(url, shown, { decision: "allow" });
    const again = await workerFetch(url, {
      body: new URLSearchParams({ ...shown.fields, decision: "allow" }),
      headers: { cookie: shown.cookie },
      method: "POST",
    });
    expect(again.status).toBe(400);
    await expect(again.text()).resolves.toContain("This link expired or was already used.");
  });

  it("lets no assistant in on an Allow from another account than the page named", async () => {
    const named = await signUpUser("connector-named@example.test");
    const other = await signUpUser("connector-other@example.test");
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    const url = authorizeUrl(clientId, challenge, "state-3");
    const shown = await showConsent(named.cookie, url);
    expect(shown.html).toContain("connector-named@example.test");

    // signed in to the other account in another tab, with this page still open
    const switched = shown.cookie.replace(named.cookie, other.cookie);
    const allowed = await workerFetch(url, {
      body: new URLSearchParams({ ...shown.fields, decision: "allow" }),
      headers: { cookie: switched },
      method: "POST",
      redirect: "manual",
    });
    expect(allowed.status).toBe(403);
    await expect(allowed.text()).resolves.toContain("signed in to a different account");
    const listed = await accountClient(other.cookie).account.assistants.list();
    expect(listed.assistants).toStrictEqual([]);

    // refusing lets nobody in, so that answer counts from whoever gives it
    const redirect = await answerConsent(
      url,
      { ...shown, cookie: switched },
      {
        decision: "deny",
      },
    );
    expect(redirect.searchParams.get("error")).toBe("access_denied");
  });

  it("keeps a grant the person kept to reading to the read scope", async () => {
    const { cookie } = await signUpUser("connector-read@example.test");
    const minted = await connectAssistant(cookie, { readOnly: true });
    expect(minted.scope).toBe("library:read");
  });

  it("steps up a token that holds neither library scope, naming the one a client asks for first", async () => {
    // a grant the consent page never makes, completed through the provider's own helpers
    const { cookie } = await signUpUser("connector-step-up@example.test");
    const userId = await userIdOf(cookie);
    const clientId = await registerClient();
    const { challenge, verifier } = await pkcePair();
    const { helpers } = connectorAuth(env);
    const { redirectTo } = await helpers.completeAuthorization({
      metadata: { clientName: "Claude" },
      props: { accountId: userId, clientName: "Claude" },
      request: await helpers.parseAuthRequest(new Request(authorizeUrl(clientId, challenge))),
      scope: ["profile"],
      userId,
    });
    const code = new URL(redirectTo).searchParams.get("code") ?? "";
    const minted = await exchangeCode(clientId, code, verifier);
    expect(minted.scope).toBe("profile");

    const refused = await drained(initialize({ authorization: `Bearer ${minted.access_token}` }));
    expect(refused.status).toBe(403);
    const challenged = refused.headers.get("www-authenticate") ?? "";
    expect(challenged).toContain('error="insufficient_scope"');
    expect(challenged).toContain('scope="library:read"');
  });
});

describe("the account's assistants", () => {
  it("lists each assistant let in and revokes one, whose token is then challenged", async () => {
    const { cookie } = await signUpUser("connector-revoke@example.test");
    const { account } = accountClient(cookie);
    const kept = await connectAssistant(cookie, { clientName: "ChatGPT", readOnly: true });
    const revoked = await connectAssistant(cookie);

    const { assistants } = await account.assistants.list();
    expect(assistants).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientName: "Claude", scopes: ["library"] }),
        expect.objectContaining({ clientName: "ChatGPT", scopes: ["library:read"] }),
      ]),
    );
    const claude = assistants.find((assistant) => assistant.clientName === "Claude");
    await expect(
      account.assistants.revoke({ grantId: claude?.grantId ?? "" }),
    ).resolves.toStrictEqual({
      revoked: true,
    });
    await expect(account.assistants.revoke({ grantId: claude?.grantId ?? "" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );

    const challenged = await drained(
      initialize({ authorization: `Bearer ${revoked.access_token}` }),
    );
    expect(challenged.status).toBe(401);
    const answered = await drained(initialize({ authorization: `Bearer ${kept.access_token}` }));
    expect(answered.status).toBe(200);
    const left = await account.assistants.list();
    expect(left.assistants).toHaveLength(1);
  });

  it("ends an assistant's access though a renewal was writing its grant back as it was disconnected", async () => {
    const { cookie } = await signUpUser("connector-race@example.test");
    const { account } = accountClient(cookie);
    const minted = await connectAssistant(cookie);
    const { assistants } = await account.assistants.list();

    // the renewal has read the grant and is about to write it back when the revoke runs; flags,
    // since a promise resolved from one request's context would carry the other's on with it
    let reachedWrite = false;
    let revokeRan = false;
    const put = env.OAUTH_KV.put.bind(env.OAUTH_KV);
    const heldWrite = vi.spyOn(env.OAUTH_KV, "put").mockImplementation(async (key, ...rest) => {
      if (key.startsWith("grant:")) {
        reachedWrite = true;
        await vi.waitUntil(() => revokeRan);
      }
      await put(key, ...rest);
    });
    const renewing = refresh(minted.clientId, minted.refresh_token);
    await vi.waitUntil(() => reachedWrite);
    await account.assistants.revoke({ grantId: assistants[0]?.grantId ?? "" });
    revokeRan = true;
    const renewal = await renewing;
    heldWrite.mockRestore();
    const renewed = z
      .object({ access_token: z.string(), refresh_token: z.string() })
      .parse(await renewal.json());

    // the grant is back in KV, and still nobody's to list or to reach
    const heldGrants = async (): Promise<number> => {
      const { items } = await connectorAuth(env).helpers.listUserGrants(await userIdOf(cookie));
      return items.length;
    };
    await expect(heldGrants()).resolves.toBe(1);
    const left = await account.assistants.list();
    expect(left.assistants).toStrictEqual([]);
    const challenged = await drained(
      initialize({ authorization: `Bearer ${renewed.access_token}` }),
    );
    expect(challenged.status).toBe(401);

    // the next renewal is refused, and the provider deletes what the first wrote back
    const refused = await refresh(minted.clientId, renewed.refresh_token);
    await expect(refused.json()).resolves.toMatchObject({ error: "invalid_grant" });
    await expect(heldGrants()).resolves.toBe(0);
  });

  it("names no other account's grant", async () => {
    const mine = await signUpUser("connector-mine@example.test");
    const theirs = await signUpUser("connector-theirs@example.test");
    await connectAssistant(theirs.cookie);
    const listed = await accountClient(theirs.cookie).account.assistants.list();
    const [grant] = listed.assistants;
    await expect(
      accountClient(mine.cookie).account.assistants.revoke({
        grantId: grant?.grantId ?? "",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

describe("the connector's budgets", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("refuses a grant's calls once its minute is spent, with when to try again", async () => {
    const { cookie } = await signUpUser("connector-budget@example.test");
    const minted = await connectAssistant(cookie);
    const listed = await accountClient(cookie).account.assistants.list();
    const [grant] = listed.assistants;
    const spent = { count: 1_000_000, lastRequest: Date.now() };
    await createDb(env.DB)
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key: grantRateKey(grant?.grantId ?? ""),
        ...spent,
      })
      .onConflictDoUpdate({ set: spent, target: rateLimit.key });
    const refused = await initialize({ authorization: `Bearer ${minted.access_token}` });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(z.object({ error: z.string() }).parse(await refused.json()).error).toBe(
      "too_many_requests",
    );
  });

  it("refuses an address's registrations once its minute is spent, and stores none of them", async () => {
    const address = { [CALLER_IP_HEADER]: "203.0.113.40" };
    const spent = { count: 1_000_000, lastRequest: Date.now() };
    await createDb(env.DB)
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key: callerRateKey("clientRegistration", new Request(ORIGIN, { headers: address })),
        ...spent,
      })
      .onConflictDoUpdate({ set: spent, target: rateLimit.key });
    const before = await env.OAUTH_KV.list();
    const refused = await registration("Claude", address);
    expect(refused.status).toBe(429);
    expect(z.object({ error: z.string() }).parse(await refused.json()).error).toBe(
      "too_many_requests",
    );
    const after = await env.OAUTH_KV.list();
    expect(after.keys).toStrictEqual(before.keys);

    const other = await drained(registration("Claude", { [CALLER_IP_HEADER]: "203.0.113.41" }));
    expect(other.status).toBe(201);
  });
});
