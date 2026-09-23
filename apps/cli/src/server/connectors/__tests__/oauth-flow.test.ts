import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";

import { createConnectorsService } from "../connectors-service";
import { ConnectorsStore } from "../connectors-store";
import { handleConnectorOauthCallback } from "../oauth-callback";
import { createConnectorOauthFlow } from "../oauth-flow";
import type { ConnectorOauthFlow, OauthCompletion } from "../oauth-flow";
import { makeTempDir } from "../../__tests__/temp-dir";

const REDIRECT_URI = "http://127.0.0.1:4664/connectors/oauth/callback";

interface ProviderAnswer {
  status: number;
  body: unknown;
}

type ProviderResponder = ProviderAnswer | ((request: URLSearchParams) => ProviderAnswer);

interface FakeProvider {
  server: Server;
  tokenEndpoint: string;
  requests: URLSearchParams[];
  respondWith: ProviderResponder;
  close: () => Promise<void>;
}

const startFakeProvider = async (): Promise<FakeProvider> => {
  const requests: URLSearchParams[] = [];
  const provider: Pick<FakeProvider, "respondWith"> = {
    respondWith: {
      body: { access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" },
      status: 200,
    },
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf-8");
    });
    request.on("end", () => {
      const params = new URLSearchParams(raw);
      requests.push(params);
      const answer =
        provider.respondWith instanceof Function
          ? provider.respondWith(params)
          : provider.respondWith;
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const address = server.address();
  const port = address !== null && address instanceof Object ? address.port : null;
  if (port === null) {
    throw new Error("fake provider did not bind");
  }
  const started: FakeProvider = {
    close: async () => {
      const closed = once(server, "close");
      server.close();
      await closed;
    },
    requests,
    get respondWith() {
      return provider.respondWith;
    },
    set respondWith(next) {
      provider.respondWith = next;
    },
    server,
    tokenEndpoint: `http://127.0.0.1:${String(port)}/oauth/token`,
  };
  onTestFinished(async () => {
    await started.close();
  });
  return started;
};

const storeWithOauthRow = (
  tokenEndpoint: string,
  url = "https://mcp.linear.app/mcp",
): ConnectorsStore => {
  const dir = makeTempDir("inteligir-oauth-");
  const store = new ConnectorsStore(dir);
  const service = createConnectorsService(store);
  service.add({
    name: "linear",
    transport: {
      authorizationEndpoint: "https://linear.example/oauth/authorize",
      clientId: "client-123",
      kind: "oauth",
      scopes: ["read", "write"],
      tokenEndpoint,
      url,
    },
  });
  return store;
};

// the consent page's round trip, collapsed: the state begin armed comes straight back.
const authorize = async (flow: ConnectorOauthFlow): Promise<OauthCompletion> => {
  const state = new URL(await flow.begin("linear", REDIRECT_URI)).searchParams.get("state");
  if (state === null) {
    throw new Error("begin armed no state");
  }
  return await flow.complete({ code: "code", state });
};

const statusOf = (store: ConnectorsStore): string => {
  const [view] = createConnectorsService(store).list();
  if (view === undefined || view.transport.kind !== "oauth") {
    throw new Error("expected the oauth row");
  }
  return view.transport.status;
};

// expires_in 1s with the 60s skew means the token is born stale.
const STALE_GRANT: ProviderAnswer = {
  body: { access_token: "at-0", expires_in: 1, refresh_token: "rt-0" },
  status: 200,
};

const s256 = (verifier: string): string =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

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
    expect(url.searchParams.get("resource")).toBe("https://mcp.linear.app/mcp");
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("code_challenge");
    expect(state).toHaveLength(32);
    expect(challenge).not.toBeNull();
    if (state === null || challenge === null) {
      return;
    }

    const completion = await flow.complete({ code: "code-abc", state });
    expect(completion).toEqual({ kind: "connected", name: "linear" });

    const [exchange] = provider.requests;
    expect(exchange).toBeDefined();
    if (exchange === undefined) {
      return;
    }
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code")).toBe("code-abc");
    expect(exchange.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(exchange.get("resource")).toBe("https://mcp.linear.app/mcp");
    const verifier = exchange.get("code_verifier");
    expect(verifier).not.toBeNull();
    if (verifier === null) {
      return;
    }
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
    if (state === null) {
      return;
    }

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
    provider.respondWith = { body: { error: "invalid_grant" }, status: 400 };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) {
      return;
    }

    const completion = await flow.complete({ code: "bad", state });
    expect(completion.kind).toBe("refused");
    expect(await flow.freshAccessToken("linear")).toBeNull();
  });

  it("refreshes an expired token and keeps an unrotated refresh token", async () => {
    const provider = await startFakeProvider();
    provider.respondWith = {
      body: { access_token: "at-old", expires_in: 1, refresh_token: "rt-keep" },
      status: 200,
    };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);
    await authorize(flow);

    provider.respondWith = { body: { access_token: "at-new", expires_in: 3600 }, status: 200 };
    expect(await flow.freshAccessToken("linear")).toBe("at-new");
    const [, refresh] = provider.requests;
    expect(refresh).toBeDefined();
    if (refresh === undefined) {
      return;
    }
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("rt-keep");
    expect(refresh.get("resource")).toBe("https://mcp.linear.app/mcp");

    provider.respondWith = {
      body: { access_token: "at-old2", expires_in: 1, refresh_token: "rt-keep" },
      status: 200,
    };
    expect(await flow.freshAccessToken("linear")).toBe("at-new");
  });

  it("a refused refresh marks needs-reauth and excludes the row, not the boot", async () => {
    const provider = await startFakeProvider();
    provider.respondWith = STALE_GRANT;
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);
    await authorize(flow);

    provider.respondWith = { body: { error: "invalid_grant" }, status: 400 };
    expect(await flow.freshAccessToken("linear")).toBeNull();
    expect(statusOf(store)).toBe("needs-reauth");
  });

  it("redacts tokens from every read and disconnect returns the row to needs-auth", async () => {
    const provider = await startFakeProvider();
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const service = createConnectorsService(store);
    const flow = createConnectorOauthFlow(store);
    await authorize(flow);

    expect(JSON.stringify(service.list())).not.toContain("at-1");
    expect(JSON.stringify(service.list())).not.toContain("rt-1");

    flow.disconnect("linear");
    expect(statusOf(store)).toBe("needs-auth");
    expect(await flow.freshAccessToken("linear")).toBeNull();
  });

  it("names the MCP server by its canonical uri: lowercase scheme and host, no fragment or trailing slash", async () => {
    const provider = await startFakeProvider();
    const cased = createConnectorOauthFlow(
      storeWithOauthRow(provider.tokenEndpoint, "HTTPS://MCP.Linear.App:8443/Mcp/#tools"),
    );
    const casedUrl = new URL(await cased.begin("linear", REDIRECT_URI));
    expect(casedUrl.searchParams.get("resource")).toBe("https://mcp.linear.app:8443/Mcp");

    const bare = createConnectorOauthFlow(
      storeWithOauthRow(provider.tokenEndpoint, "https://mcp.example.com/"),
    );
    const bareUrl = new URL(await bare.begin("linear", REDIRECT_URI));
    expect(bareUrl.searchParams.get("resource")).toBe("https://mcp.example.com");
  });

  it("two sessions starting together spend a rotating refresh token once", async () => {
    const provider = await startFakeProvider();
    let current = "rt-0";
    let minted = 0;
    // rotates on every spend and refuses a spent token, as a provider must for a public client.
    provider.respondWith = (request) => {
      if (request.get("grant_type") === "authorization_code") {
        return STALE_GRANT;
      }
      if (request.get("refresh_token") !== current) {
        return { body: { error: "invalid_grant" }, status: 400 };
      }
      minted += 1;
      current = `rt-${String(minted)}`;
      return {
        body: { access_token: `at-${String(minted)}`, expires_in: 3600, refresh_token: current },
        status: 200,
      };
    };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);
    await authorize(flow);

    const answers = await Promise.all([
      flow.freshAccessToken("linear"),
      flow.freshAccessToken("linear"),
    ]);
    expect(answers).toEqual(["at-1", "at-1"]);
    const refreshes = provider.requests.filter(
      (request) => request.get("grant_type") === "refresh_token",
    );
    expect(refreshes).toHaveLength(1);
    expect(statusOf(store)).toBe("connected");
    expect(await flow.freshAccessToken("linear")).toBe("at-1");
  });

  it("a disconnect made while a refresh is in flight wins over its answer", async () => {
    const provider = await startFakeProvider();
    provider.respondWith = STALE_GRANT;
    const reached: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    let holding = false;
    const heldFetch: typeof fetch = async (input, init) => {
      if (holding) {
        reached.resolve();
        await release.promise;
      }
      return await fetch(input, init);
    };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store, heldFetch);
    await authorize(flow);

    provider.respondWith = {
      body: { access_token: "at-late", expires_in: 3600, refresh_token: "rt-late" },
      status: 200,
    };
    holding = true;
    const answer = flow.freshAccessToken("linear");
    await reached.promise;
    flow.disconnect("linear");
    release.resolve();

    expect(await answer).toBeNull();
    expect(statusOf(store)).toBe("needs-auth");
    expect(JSON.stringify(store.read())).not.toContain("at-late");
  });

  it("a token endpoint that is down or unreachable excludes the row without costing a re-consent", async () => {
    const provider = await startFakeProvider();
    provider.respondWith = STALE_GRANT;
    let reachable = true;
    const flakyFetch: typeof fetch = async (input, init) => {
      if (!reachable) {
        throw new TypeError("fetch failed");
      }
      return await fetch(input, init);
    };
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store, flakyFetch);
    await authorize(flow);

    provider.respondWith = { body: { error: "temporarily_unavailable" }, status: 503 };
    expect(await flow.freshAccessToken("linear")).toBeNull();
    expect(statusOf(store)).toBe("connected");

    reachable = false;
    expect(await flow.freshAccessToken("linear")).toBeNull();
    expect(statusOf(store)).toBe("connected");

    reachable = true;
    provider.respondWith = {
      body: { access_token: "at-back", expires_in: 3600, refresh_token: "rt-back" },
      status: 200,
    };
    expect(await flow.freshAccessToken("linear")).toBe("at-back");
  });

  it("a callback for a connector removed mid-flow answers the page, spending no code", async () => {
    const provider = await startFakeProvider();
    const store = storeWithOauthRow(provider.tokenEndpoint);
    const flow = createConnectorOauthFlow(store);
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) {
      return;
    }
    createConnectorsService(store).remove("linear");

    const callback = new URL(`${REDIRECT_URI}?code=code&state=${state}`);
    const page = await handleConnectorOauthCallback(flow, callback);
    expect(page.status).toBe(400);
    expect(page.body).toContain("That connector is gone");
    expect(provider.requests).toHaveLength(0);
  });

  it("dispose makes a late callback inert", async () => {
    const provider = await startFakeProvider();
    const flow = createConnectorOauthFlow(storeWithOauthRow(provider.tokenEndpoint));
    const url = new URL(await flow.begin("linear", REDIRECT_URI));
    const state = url.searchParams.get("state");
    if (state === null) {
      return;
    }
    flow.dispose();
    expect(await flow.complete({ code: "code", state })).toEqual({ kind: "no-pending" });
    expect(provider.requests).toHaveLength(0);
  });
});
