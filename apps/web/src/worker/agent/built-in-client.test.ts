import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { listAssistants } from "../connector/assistant-grants";
import { connectorAuth } from "../connector/connector-auth";
import { pkcePair } from "../connector/pkce";
import { createDb } from "../db/client";
import { builtInClient } from "../db/schema";
import { ORIGIN, signUpUser, userIdOf } from "../test-support/cloud-helpers";
import { CONNECTOR_URL, connectorClient, workerFetch } from "../test-support/connector-session";
import { newAccountId } from "../test-support/library-cell";
import { builtInClientId, grantBuiltInAgent } from "./built-in-client";

const DAY_SECONDS = 24 * 60 * 60;

const refreshedSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

// a refresh as Anthropic's vault sends one: the client, the resource and the scope its credential
// names, and no secret
const refresh = async (clientId: string, refreshToken: string): Promise<Response> =>
  await workerFetch(`${ORIGIN}/oauth/token`, {
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      resource: CONNECTOR_URL,
      scope: "library",
    }),
    method: "POST",
  });

const grantsOf = async (accountId: string) => {
  const listed = await connectorAuth(env).helpers.listUserGrants(accountId);
  return listed.items;
};

describe("the built-in agent's OAuth client", () => {
  it("is granted in process with no page asked, and its token opens the connector", async () => {
    const accountId = newAccountId();
    const grant = await grantBuiltInAgent(connectorAuth(env), env, {
      accountId,
      endpoint: exports.default,
    });
    expect(grant).toMatchObject({
      resource: CONNECTOR_URL,
      scope: "library",
      tokenEndpoint: `${ORIGIN}/oauth/token`,
    });
    expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());
    const grants = await grantsOf(accountId);
    expect(grants.map((held) => [held.id, held.clientId, held.scope, held.metadata])).toEqual([
      [grant.grantId, grant.clientId, ["library"], { kind: "agent" }],
    ]);
    // the agent's own switch makes and revokes it, so the list of assistants leaves it out
    expect(await listAssistants(connectorAuth(env).helpers, accountId)).toEqual([]);
    const client = await connectorClient(grant.accessToken);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("search_library");
    await client.close();
  });

  it("is the deployment's one client, and an account's new grant replaces its last", async () => {
    const accountId = newAccountId();
    const auth = connectorAuth(env);
    const first = await grantBuiltInAgent(auth, env, { accountId, endpoint: exports.default });
    const second = await grantBuiltInAgent(auth, env, { accountId, endpoint: exports.default });
    expect(second.clientId).toBe(first.clientId);
    const grants = await grantsOf(accountId);
    expect(grants.map((held) => held.id)).toEqual([second.grantId]);
    const rows = await createDb(env.DB)
      .select()
      .from(builtInClient)
      .where(eq(builtInClient.issuer, ORIGIN))
      .all();
    expect(rows).toEqual([{ clientId: first.clientId, issuer: ORIGIN }]);
  });

  it("is registered again once the provider no longer holds it", async () => {
    const auth = connectorAuth(env);
    const lost = await builtInClientId(env, auth);
    await auth.helpers.deleteClient(lost);
    const registered = await builtInClientId(env, auth);
    expect(registered).not.toBe(lost);
    expect(await auth.helpers.lookupClient(registered)).toMatchObject({
      clientName: "Built-in agent",
      tokenEndpointAuthMethod: "none",
    });
    expect(await builtInClientId(env, auth)).toBe(registered);
  });

  it("rotates its refresh token, and its grant lives 30 days past the last refresh", async () => {
    const accountId = newAccountId();
    const grant = await grantBuiltInAgent(connectorAuth(env), env, {
      accountId,
      endpoint: exports.default,
    });
    const once = await refresh(grant.clientId, grant.refreshToken);
    expect(once.status).toBe(200);
    const rotated = refreshedSchema.parse(await once.json());
    expect(rotated.refresh_token).not.toBe(grant.refreshToken);
    // the rotated token's use retires the first for good
    const twice = await refresh(grant.clientId, rotated.refresh_token);
    expect(twice.status).toBe(200);
    await twice.arrayBuffer();
    const stale = await refresh(grant.clientId, grant.refreshToken);
    expect(stale.status).toBe(400);
    expect(await stale.json()).toMatchObject({ error: "invalid_grant" });
    const [held] = await grantsOf(accountId);
    const lapses = (held?.expiresAt ?? 0) - Math.floor(Date.now() / 1000);
    expect(Math.abs(lapses - 30 * DAY_SECONDS)).toBeLessThan(120);
  });

  it("is never let in through the consent page, whose code would come back here", async () => {
    const { cookie } = await signUpUser("built-in-consent@example.test");
    const accountId = await userIdOf(cookie);
    const clientId = await builtInClientId(env, connectorAuth(env));
    const { challenge } = await pkcePair();
    const url = new URL("/connect/authorize", ORIGIN);
    for (const [name, value] of Object.entries({
      client_id: clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: `${ORIGIN}/connect/built-in-agent`,
      resource: CONNECTOR_URL,
      response_type: "code",
      scope: "library",
      state: "forged",
    })) {
      url.searchParams.set(name, value);
    }
    const response = await workerFetch(url, { headers: { cookie } });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("doesn&#39;t come from an assistant");
    expect(await grantsOf(accountId)).toEqual([]);
  });
});
