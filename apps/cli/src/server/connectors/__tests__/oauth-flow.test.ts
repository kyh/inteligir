import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";

import { createConnectorsService } from "../connectors-service";
import { ConnectorsStore } from "../connectors-store";
import { createConnectorOauthFlow } from "../oauth-flow";
import { makeTempDir } from "../../__tests__/temp-dir";

const REDIRECT_URI = "http://127.0.0.1:4664/connectors/oauth/callback";

interface FakeProvider {
  server: Server;
  tokenEndpoint: string;
  requests: URLSearchParams[];
  respondWith: { status: number; body: unknown };
  close(): Promise<void>;
}

async function startFakeProvider(): Promise<FakeProvider> {
  const requests: URLSearchParams[] = [];
  const provider: Omit<FakeProvider, "server" | "tokenEndpoint" | "close"> = {
    requests,
    respondWith: {
      status: 200,
      body: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 },
    },
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      requests.push(new URLSearchParams(raw));
      response.writeHead(provider.respondWith.status, { "content-type": "application/json" });
      response.end(JSON.stringify(provider.respondWith.body));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address !== null && address instanceof Object ? address.port : null;
  if (port === null) {
    throw new Error("fake provider did not bind");
  }
  const started: FakeProvider = {
    server,
    tokenEndpoint: `http://127.0.0.1:${String(port)}/oauth/token`,
    requests,
    get respondWith() {
      return provider.respondWith;
    },
    set respondWith(next) {
      provider.respondWith = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  onTestFinished(() => started.close());
  return started;
}

function storeWithOauthRow(tokenEndpoint: string): ConnectorsStore {
  const dir = makeTempDir("inteligir-oauth-");
  const store = new ConnectorsStore(dir);
  const service = createConnectorsService(store);
  service.add({
    name: "linear",
    transport: {
      kind: "oauth",
      url: "https://mcp.linear.app/mcp",
      authorizationEndpoint: "https://linear.example/oauth/authorize",
      tokenEndpoint,
      clientId: "client-123",
      scopes: ["read", "write"],
    },
  });
  return store;
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

describe("the connector OAuth flow", () => {
  it("runs the whole dance: authorize URL, callback, PKCE-checked exchange, stored tokens", async () => {
    const provider = await startFakeProvider();
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);

    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    expect(url.origin + url.pathname).toBe("https://linear.example/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("read write");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("code_challenge");
    expect(state).toHaveLength(32);
    expect(challenge).not.toBeNull();
    if (state === null || challenge === null) return;

    const completion = await flow.complete({ code: "code-abc", state });
    expect(completion).toEqual({ kind: "connected", name: "linear" });

    const exchange = provider.requests[0];
    expect(exchange).toBeDefined();
    if (exchange === undefined) return;
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code")).toBe("code-abc");
    expect(exchange.get("redirect_uri")).toBe(REDIRECT_URI);
    const verifier = exchange.get("code_verifier");
    expect(verifier).not.toBeNull();
    if (verifier === null) return;
    expect(s256(verifier)).toBe(challenge);

    expect(await flow.freshAccessToken("linear")).toBe("at-1");
    expect(provider.requests).toHaveLength(1);

    expect(await flow.complete({ code: "code-abc", state })).toEqual({ kind: "no-pending" });
  });

  it("a wrong state consumes nothing — the real callback still lands", async () => {
    const provider = await startFakeProvider();
    const flow = createConnectorOauthFlow(storeWithOauthRow(provider.tokenEndpoint));
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) return;

    expect(await flow.complete({ code: "x", state: "0".repeat(32) })).toEqual({
      kind: "state-mismatch",
    });
    expect(provider.requests).toHaveLength(0);
    expect(await flow.complete({ code: "code-abc", state })).toEqual({
      kind: "connected",
      name: "linear",
    });
  });

  it("a refused exchange answers refused and stores nothing", async () => {
    const provider = await startFakeProvider();
    provider.respondWith = { status: 400, body: { error: "invalid_grant" } };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) return;

    const completion = await flow.complete({ code: "bad", state });
    expect(completion.kind).toBe("refused");
    expect(await flow.freshAccessToken("linear")).toBeNull();
  });

  it("refreshes an expired token and keeps an unrotated refresh token", async () => {
    const provider = await startFakeProvider();
    // expires_in 1s with the 60s skew means the token is born stale.
    provider.respondWith = {
      status: 200,
      body: { access_token: "at-old", refresh_token: "rt-keep", expires_in: 1 },
    };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) return;
    await flow.complete({ code: "code", state });

    provider.respondWith = { status: 200, body: { access_token: "at-new", expires_in: 3600 } };
    expect(await flow.freshAccessToken("linear")).toBe("at-new");
    const refresh = provider.requests[1];
    expect(refresh).toBeDefined();
    if (refresh === undefined) return;
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("rt-keep");

    provider.respondWith = {
      status: 200,
      body: { access_token: "at-old2", refresh_token: "rt-keep", expires_in: 1 },
    };
    expect(await flow.freshAccessToken("linear")).toBe("at-new");
  });

  it("a refused refresh marks needs-reauth and excludes the row, not the boot", async () => {
    const provider = await startFakeProvider();
    provider.respondWith = {
      status: 200,
      body: { access_token: "at-stale", refresh_token: "rt-dead", expires_in: 1 },
    };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const service = createConnectorsService(store);
    const flow = createConnectorOauthFlow(store);
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) return;
    await flow.complete({ code: "code", state });

    provider.respondWith = { status: 400, body: { error: "invalid_grant" } };
    expect(await flow.freshAccessToken("linear")).toBeNull();

    const view = service.list()[0];
    expect(view).toBeDefined();
    if (view === undefined || view.transport.kind !== "oauth") {
      throw new Error("expected the oauth row");
    }
    expect(view.transport.status).toBe("needs-reauth");
  });

  it("redacts tokens from every read and disconnect returns the row to needs-auth", async () => {
    const provider = await startFakeProvider();
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const service = createConnectorsService(store);
    const flow = createConnectorOauthFlow(store);
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) return;
    await flow.complete({ code: "code", state });

    expect(JSON.stringify(service.list())).not.toContain("at-1");
    expect(JSON.stringify(service.list())).not.toContain("rt-1");

    flow.disconnect("linear");
    const view = service.list()[0];
    if (view === undefined || view.transport.kind !== "oauth") {
      throw new Error("expected the oauth row");
    }
    expect(view.transport.status).toBe("needs-auth");
    expect(await flow.freshAccessToken("linear")).toBeNull();
  });

  it("an endpoint update keeps stored tokens (no edit forces re-consent)", async () => {
    const provider = await startFakeProvider();
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const service = createConnectorsService(store);
    const flow = createConnectorOauthFlow(store);
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) return;
    await flow.complete({ code: "code", state });

    service.update({
      name: "linear",
      transport: {
        kind: "oauth",
        url: "https://mcp.linear.app/sse",
        authorizationEndpoint: "https://linear.example/oauth/authorize",
        tokenEndpoint: provider.tokenEndpoint,
        clientId: "client-123",
        scopes: ["read"],
      },
    });
    expect(await flow.freshAccessToken("linear")).toBe("at-1");
  });

  it("dispose makes a late callback inert", async () => {
    const provider = await startFakeProvider();
    const flow = createConnectorOauthFlow(storeWithOauthRow(provider.tokenEndpoint));
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) return;
    flow.dispose();
    expect(await flow.complete({ code: "code", state })).toEqual({ kind: "no-pending" });
    expect(provider.requests).toHaveLength(0);
  });
});
