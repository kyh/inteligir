// The connector's OAuth as an assistant meets it: the challenge and the two metadata documents it
// discovers the authorization server by, registration, the consent page with PKCE, the code it
// trades for a token minted for this connector alone, and the account's list and revoke.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createDb } from "../db/client";
import { connectorAuth } from "./connector-auth";
import { rateLimit } from "../db/schema";
import { CALLER_IP_HEADER, callerRateKey, deviceRateKey } from "../rate-limit";
import {
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import {
  answerConsent,
  authorizeUrl,
  connectAssistant,
  CONNECTOR_URL,
  exchangeCode,
  pkcePair,
  registerClient,
  registration,
  showConsent,
  workerFetch,
} from "../test-support/connector-session";

// an MCP request any client opens with, here sent bare to see what answers it
const initialize = (headers: Record<string, string> = {}) =>
  workerFetch(CONNECTOR_URL, {
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

const accountClient = (credential: string): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await workerFetch(url, init),
      headers: deviceHeaders(credential),
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
    expect(await resource.json()).toEqual({
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ["header"],
      resource: CONNECTOR_URL,
      resource_name: "Inteligir library",
      scopes_supported: ["library:read"],
    });

    const server = await workerFetch(`${ORIGIN}/.well-known/oauth-authorization-server`);
    expect(await server.json()).toMatchObject({
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

  it("takes no device credential: the connector is an assistant's door alone", async () => {
    const { cookie } = await signUpUser("connector-device@example.test");
    const device = await loginDevice(cookie, "Laptop");
    const refused = await drained(initialize({ authorization: `Bearer ${device.credential}` }));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
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
    // the redirect goes to an app on this machine, which the page warns of
    expect(shown.html).toContain("This sends access to an app on this computer.");
    expect(shown.response.headers.get("x-frame-options")).toBe("DENY");
    expect(shown.response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(shown.response.headers.get("cache-control")).toBe("no-store");
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
    expect(await wrong.json()).toMatchObject({ error: "invalid_grant" });

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
    expect(await minted.json()).toMatchObject({
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
      body: new URLSearchParams({ decision: "allow", handle: shown.handle }),
      headers: { cookie: shown.cookie },
      method: "POST",
    });
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("This link expired or was already used.");
  });

  it("keeps a grant the person kept to reading to the read scope", async () => {
    const { cookie } = await signUpUser("connector-read@example.test");
    const minted = await connectAssistant(cookie, { readOnly: true });
    expect(minted.scope).toBe("library:read");
  });

  it("steps up a token that holds neither library scope, naming the one any access needs", async () => {
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
    const device = await loginDevice(cookie, "Laptop");
    const { account } = accountClient(device.credential);
    const kept = await connectAssistant(cookie, { clientName: "ChatGPT", readOnly: true });
    const revoked = await connectAssistant(cookie);

    const { assistants } = await account.assistants.list();
    expect(assistants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientName: "Claude", scopes: ["library"] }),
        expect.objectContaining({ clientName: "ChatGPT", scopes: ["library:read"] }),
      ]),
    );
    const claude = assistants.find((assistant) => assistant.clientName === "Claude");
    expect(await account.assistants.revoke({ grantId: claude?.grantId ?? "" })).toEqual({
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

  it("names no other account's grant", async () => {
    const mine = await signUpUser("connector-mine@example.test");
    const theirs = await signUpUser("connector-theirs@example.test");
    await connectAssistant(theirs.cookie);
    const device = await loginDevice(theirs.cookie, "Phone");
    const listed = await accountClient(device.credential).account.assistants.list();
    const [grant] = listed.assistants;
    const myDevice = await loginDevice(mine.cookie, "Laptop");
    await expect(
      accountClient(myDevice.credential).account.assistants.revoke({
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
    const device = await loginDevice(cookie, "Laptop");
    const listed = await accountClient(device.credential).account.assistants.list();
    const [grant] = listed.assistants;
    const spent = { count: 1_000_000, lastRequest: Date.now() };
    await createDb(env.DB)
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key: deviceRateKey("connector", grant?.grantId ?? ""),
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
    expect(after.keys).toEqual(before.keys);

    const other = await drained(registration("Claude", { [CALLER_IP_HEADER]: "203.0.113.41" }));
    expect(other.status).toBe(201);
  });
});
