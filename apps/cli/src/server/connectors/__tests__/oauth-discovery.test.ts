import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ConnectorTransportInput } from "@repo/api/local/connectors/connectors-schema";
import { createConnectorsService } from "../connectors-service";
import { ConnectorsStore } from "../connectors-store";
import { createConnectorOauthFlow } from "../oauth-flow";
import type { ConnectorOauthFlow } from "../oauth-flow";
import { makeTempDir } from "../../__tests__/temp-dir";
import { beginUrl, REDIRECT_URI, startFakeProvider } from "./fake-oauth-provider";
import type { FakeProvider } from "./fake-oauth-provider";

const registrationSchema = z.looseObject({
  grant_types: z.array(z.string()),
  redirect_uris: z.array(z.string()),
  scope: z.string().optional(),
  token_endpoint_auth_method: z.string(),
});

const storeWithUrlRow = (url: string, clientId?: string): ConnectorsStore => {
  const store = new ConnectorsStore(makeTempDir("inteligir-discovery-"));
  const transport: ConnectorTransportInput = { kind: "oauth", scopes: [], url };
  if (clientId !== undefined) {
    transport.clientId = clientId;
  }
  createConnectorsService(store).add({ name: "linear", transport });
  return store;
};

const unreachable: typeof fetch = async () => await Promise.reject(new TypeError("fetch failed"));

// the browser's part: the fake consent page approves at once and redirects with a minted code.
const approve = async (flow: ConnectorOauthFlow, redirectUri = REDIRECT_URI) => {
  const authorize = await beginUrl(flow, redirectUri);
  const consent = await fetch(authorize, { redirect: "manual" });
  const back = new URL(consent.headers.get("location") ?? "");
  return await flow.complete({
    code: back.searchParams.get("code") ?? "",
    state: back.searchParams.get("state") ?? "",
  });
};

const refusalOf = async (flow: ConnectorOauthFlow): Promise<string> => {
  const begun = await flow.begin("linear", REDIRECT_URI);
  if (begun.ok) {
    throw new Error(`begin was not refused: ${begun.url}`);
  }
  return begun.detail;
};

const oauthRowOf = (store: ConnectorsStore) => {
  const [row] = store.read();
  if (row === undefined || row.transport.kind !== "oauth") {
    throw new Error("expected the oauth row");
  }
  return row.transport;
};

const serverMetadata = (provider: FakeProvider) => ({
  authorization_endpoint: provider.authorizationEndpoint,
  code_challenge_methods_supported: ["S256"],
  issuer: provider.origin,
  registration_endpoint: `${provider.origin}/register`,
  token_endpoint: provider.tokenEndpoint,
});

describe("connector OAuth discovery", () => {
  it("authorizes a row named by its URL alone: discovery, registration, consent, exchange", async () => {
    const provider = await startFakeProvider();
    const store = storeWithUrlRow(provider.mcpUrl);
    const flow = createConnectorOauthFlow(store);

    const authorize = await beginUrl(flow);
    expect(authorize.origin + authorize.pathname).toBe(provider.authorizationEndpoint);
    expect(authorize.searchParams.get("client_id")).toBe("dcr-1");
    // the challenge's scope outranks the metadata's scopes_supported.
    expect(authorize.searchParams.get("scope")).toBe("read write");
    expect(authorize.searchParams.get("resource")).toBe(provider.mcpUrl);
    const [registration] = provider.registrations.map((body) => registrationSchema.parse(body));
    expect(registration).toMatchObject({
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [REDIRECT_URI],
      scope: "read write",
      token_endpoint_auth_method: "none",
    });
    // kept before the consent, so the Connect retried after a closed tab registers nothing new.
    expect(oauthRowOf(store).discovered?.registration).toEqual({
      clientId: "dcr-1",
      redirectUri: REDIRECT_URI,
    });

    expect(await approve(flow)).toEqual({ kind: "connected", name: "linear" });
    expect(provider.registrations).toHaveLength(1);
    const [exchange] = provider.requests;
    expect(exchange?.get("client_id")).toBe("dcr-1");
    expect(exchange?.get("resource")).toBe(provider.mcpUrl);
    expect(await flow.freshAccessToken("linear")).toBe("at-1");

    const [view] = createConnectorsService(store).list();
    expect(view?.transport).toMatchObject({
      authorizationEndpoint: provider.authorizationEndpoint,
      clientId: "dcr-1",
      status: "connected",
      tokenEndpoint: provider.tokenEndpoint,
    });
  });

  it("refreshes at the discovered token endpoint with the registered client", async () => {
    const provider = await startFakeProvider();
    provider.respondWith = {
      body: { access_token: "at-0", expires_in: 1, refresh_token: "rt-0" },
      status: 200,
    };
    const flow = createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl));
    await approve(flow);

    provider.respondWith = { body: { access_token: "at-2", expires_in: 3600 }, status: 200 };
    expect(await flow.freshAccessToken("linear")).toBe("at-2");
    const refresh = provider.requests.at(-1);
    expect(refresh?.get("grant_type")).toBe("refresh_token");
    expect(refresh?.get("client_id")).toBe("dcr-1");
  });

  it("reuses a registration for its redirect uri, registers again for another, and forgets it on disconnect", async () => {
    const provider = await startFakeProvider();
    const store = storeWithUrlRow(provider.mcpUrl);
    const flow = createConnectorOauthFlow(store);

    await approve(flow);
    await approve(flow);
    expect(provider.registrations).toHaveLength(1);

    // the grant still rests on dcr-1, so the new client waits for a grant of its own.
    const otherRedirect = "http://localhost:4664/connectors/oauth/callback";
    const elsewhere = await beginUrl(flow, otherRedirect);
    expect(elsewhere.searchParams.get("client_id")).toBe("dcr-2");
    expect(provider.registrations).toHaveLength(2);
    expect(oauthRowOf(store).discovered?.registration?.clientId).toBe("dcr-1");
    expect(await approve(flow, otherRedirect)).toEqual({ kind: "connected", name: "linear" });
    expect(oauthRowOf(store).discovered?.registration?.clientId).toBe("dcr-3");

    flow.disconnect("linear");
    expect(oauthRowOf(store).discovered).toBeUndefined();
    const afresh = await beginUrl(flow);
    expect(afresh.searchParams.get("client_id")).toBe("dcr-4");
  });

  it("a row's own client id is used and nothing is registered", async () => {
    const provider = await startFakeProvider();
    const flow = createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl, "my-client"));
    expect(await approve(flow)).toEqual({ kind: "connected", name: "linear" });
    expect(provider.registrations).toHaveLength(0);
    expect(provider.requests[0]?.get("client_id")).toBe("my-client");
  });

  it("with no challenge, falls back from the path's metadata to the root's, and to openid discovery", async () => {
    const provider = await startFakeProvider();
    provider.challenge = null;
    provider.documents.delete("/.well-known/oauth-protected-resource/mcp");
    provider.documents.set("/.well-known/oauth-protected-resource", {
      authorization_servers: [provider.origin],
      resource: provider.origin,
      scopes_supported: ["read"],
    });
    provider.documents.delete("/.well-known/oauth-authorization-server");
    provider.documents.set("/.well-known/openid-configuration", serverMetadata(provider));

    const authorize = await beginUrl(createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl)));
    expect(authorize.searchParams.get("scope")).toBe("read");
    expect(provider.hits).toEqual([
      "GET /mcp",
      "GET /.well-known/oauth-protected-resource/mcp",
      "GET /.well-known/oauth-protected-resource",
      "GET /.well-known/oauth-authorization-server",
      "GET /.well-known/openid-configuration",
      "POST /register",
    ]);
  });

  it("follows the challenge's resource_metadata rather than guessing", async () => {
    const provider = await startFakeProvider();
    provider.challenge = `Bearer realm="OAuth", resource_metadata="${provider.origin}/meta/mcp"`;
    const document = provider.documents.get("/.well-known/oauth-protected-resource/mcp");
    provider.documents.delete("/.well-known/oauth-protected-resource/mcp");
    provider.documents.set("/meta/mcp", document);

    await beginUrl(createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl)));
    expect(provider.hits.slice(0, 2)).toEqual(["GET /mcp", "GET /meta/mcp"]);
  });

  it("refuses metadata that names another resource, and registers nothing", async () => {
    const provider = await startFakeProvider();
    provider.documents.set("/.well-known/oauth-protected-resource/mcp", {
      authorization_servers: [provider.origin],
      resource: `${provider.origin}/other`,
    });
    const detail = await refusalOf(createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl)));
    expect(detail).toContain("publishes no OAuth metadata for this URL");
    expect(provider.registrations).toHaveLength(0);
  });

  it("refuses an authorization server whose metadata names another issuer", async () => {
    const provider = await startFakeProvider();
    provider.documents.set("/.well-known/oauth-authorization-server", {
      ...serverMetadata(provider),
      issuer: "https://impostor.example",
    });
    const detail = await refusalOf(createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl)));
    expect(detail).toContain("publishes no metadata");
  });

  it("refuses an authorization server that does not advertise S256", async () => {
    const provider = await startFakeProvider();
    provider.documents.set("/.well-known/oauth-authorization-server", {
      ...serverMetadata(provider),
      code_challenge_methods_supported: ["plain"],
    });
    const detail = await refusalOf(createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl)));
    expect(detail).toContain("PKCE (S256)");
    expect(provider.registrations).toHaveLength(0);
  });

  it("refuses to register where the server offers no registration, naming the way out", async () => {
    const provider = await startFakeProvider();
    // an undefined key leaves the served JSON without it.
    provider.documents.set("/.well-known/oauth-authorization-server", {
      ...serverMetadata(provider),
      registration_endpoint: undefined,
    });
    const detail = await refusalOf(createConnectorOauthFlow(storeWithUrlRow(provider.mcpUrl)));
    expect(detail).toContain("name a client id");
  });

  it("refuses a registration made for a confidential client", async () => {
    const provider = await startFakeProvider();
    provider.registrationAnswer = {
      body: {
        client_id: "c",
        client_secret: "s",
        token_endpoint_auth_method: "client_secret_basic",
      },
      status: 201,
    };
    const store = storeWithUrlRow(provider.mcpUrl);
    const detail = await refusalOf(createConnectorOauthFlow(store));
    expect(detail).toContain("client_secret_basic");
    expect(oauthRowOf(store).discovered).toBeUndefined();
  });

  it("reads no plain-http server off this machine", async () => {
    let fetched = false;
    const neverFetch: typeof fetch = async () => {
      fetched = true;
      return await Promise.reject(new Error("no request expected"));
    };
    const flow = createConnectorOauthFlow(
      storeWithUrlRow("http://mcp.example.com/mcp"),
      neverFetch,
    );
    expect(await refusalOf(flow)).toContain("https://");
    expect(fetched).toBe(false);
  });

  it("a server that does not answer is said so", async () => {
    const flow = createConnectorOauthFlow(
      storeWithUrlRow("https://mcp.example.com/mcp"),
      unreachable,
    );
    expect(await refusalOf(flow)).toBe("The MCP server at mcp.example.com did not answer.");
  });
});
