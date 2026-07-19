// Host-side connector install/uninstall orchestration (#461 Phase 4a) — the
// step sequence, rollback-on-failure, and re-entrancy guard, driven over fake
// ConnectorInstallOps (the executor-client / browser-open seam the handler
// binds for real). Ported from the renderer's connector-install tests when the
// orchestration moved server-side.

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CONNECTION_NAME,
  getPendingConnectorAuth,
  installConnector,
  uninstallConnector,
  type ConnectorInstallOps,
} from "../connectors/connector-install";
import { setDevFlagsAllowed } from "../dev-flags";
import type { PendingConnectorAuth } from "@repo/features/ipc-registry";
import {
  GOOGLE_OAUTH_CLIENT_SLUG,
  type ConnectorInstallRequest,
  type ExecutorConnection,
  type ExecutorIntegration,
  type ExecutorOAuthClient,
  type OAuthAwaitResult,
  type OAuthProbeResult,
  type OAuthStartResult,
} from "@repo/features/executor";

// Catalog-shaped install requests (the renderer maps its catalog to these).
const GITHUB: ConnectorInstallRequest = {
  source: {
    type: "mcp",
    slug: "github",
    name: "GitHub",
    endpoint: "https://api.githubcopilot.com/mcp/",
  },
  auth: { kind: "oauth" },
};

const HUGGINGFACE: ConnectorInstallRequest = {
  source: {
    type: "mcp",
    slug: "huggingface",
    name: "Hugging Face",
    endpoint: "https://huggingface.co/mcp",
  },
  auth: { kind: "apiKey", headerName: "Authorization", prefix: "Bearer ", value: "hf_token" },
};

const GMAIL: ConnectorInstallRequest = {
  source: {
    type: "google",
    slug: "gmail",
    name: "Gmail",
    discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
  },
  auth: { kind: "google" },
};

function integration(over: Partial<ExecutorIntegration>): ExecutorIntegration {
  return {
    slug: "x",
    description: "",
    kind: "mcp",
    canRemove: true,
    canRefresh: true,
    authMethods: [],
    ...over,
  };
}

function conn(over: Partial<ExecutorConnection>): ExecutorConnection {
  return {
    owner: "user",
    name: DEFAULT_CONNECTION_NAME,
    integration: "x",
    template: "none",
    provider: "keychain",
    address: "tools.x.user.default",
    identityLabel: null,
    expiresAt: null,
    oauthClient: null,
    oauthClientOwner: null,
    oauthScope: null,
    ...over,
  };
}

function fakeOps(overrides: Partial<ConnectorInstallOps> = {}): ConnectorInstallOps {
  return {
    listIntegrations: vi.fn(async (): Promise<ExecutorIntegration[]> => []),
    removeIntegration: vi.fn(async () => ({ removed: true })),
    addMcpIntegration: vi.fn(async () => ({ slug: "x" })),
    addOpenApiIntegration: vi.fn(async () => ({ slug: "x", toolCount: 1 })),
    addGraphqlIntegration: vi.fn(async () => ({ slug: "x", name: "X" })),
    listConnections: vi.fn(async (): Promise<ExecutorConnection[]> => []),
    createConnection: vi.fn(async () => conn({})),
    removeConnection: vi.fn(async () => ({ removed: true })),
    listOAuthClients: vi.fn(async (): Promise<ExecutorOAuthClient[]> => []),
    registerOAuthClientDynamic: vi.fn(async () => ({ client: "minted" })),
    oauthProbe: vi.fn(
      async (): Promise<OAuthProbeResult> => ({
        authorizationUrl: "https://as.example/authorize",
        tokenUrl: "https://as.example/token",
        registrationEndpoint: "https://as.example/register",
      }),
    ),
    // runOAuthFlow returns immediately on an inline ("connected") completion.
    oauthStart: vi.fn(
      async (): Promise<OAuthStartResult> => ({ status: "connected", connection: conn({}) }),
    ),
    awaitOAuth: vi.fn(async (): Promise<OAuthAwaitResult | null> => null),
    openExternal: vi.fn(async () => {}),
    waitMs: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("installConnector — Google", () => {
  it("registers a discovery-bundle integration then runs the consent flow", async () => {
    const ops = fakeOps();
    await installConnector(ops, GMAIL);
    expect(ops.addOpenApiIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "gmail",
        spec: {
          kind: "googleDiscoveryBundle",
          urls: ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest"],
        },
      }),
    );
    expect(ops.oauthStart).toHaveBeenCalledWith(
      expect.objectContaining({
        client: GOOGLE_OAUTH_CLIENT_SLUG,
        integration: "gmail",
        template: "googleOAuth2",
        owner: "user",
        name: DEFAULT_CONNECTION_NAME,
      }),
    );
    // The OAuth flow mints the connection — no explicit create.
    expect(ops.createConnection).not.toHaveBeenCalled();
  });

  it("surfaces the consent URL in the browser and resolves once the callback lands", async () => {
    const ops = fakeOps({
      oauthStart: vi.fn(
        async (): Promise<OAuthStartResult> => ({
          status: "redirect",
          authorizationUrl: "https://accounts.google.com/consent",
          state: "st-1",
        }),
      ),
      awaitOAuth: vi.fn(
        async (): Promise<OAuthAwaitResult | null> => ({
          ok: true,
          sessionId: "st-1",
          integration: "gmail",
          identityLabel: "user@example.com",
        }),
      ),
    });
    await installConnector(ops, GMAIL);
    expect(ops.openExternal).toHaveBeenCalledWith("https://accounts.google.com/consent");
    expect(ops.awaitOAuth).toHaveBeenCalledWith("st-1");
    expect(ops.removeIntegration).not.toHaveBeenCalled();
  });

  it("exposes the pending consent under the emulate flag; clears when the flow settles (#462)", async () => {
    setDevFlagsAllowed(true);
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    try {
      const authorizationUrl = "http://localhost:4000/o/oauth2/v2/auth?state=st-9&code_challenge=c";
      let seenMidFlight: PendingConnectorAuth | null = null;
      const ops = fakeOps({
        oauthStart: vi.fn(
          async (): Promise<OAuthStartResult> => ({
            status: "redirect",
            authorizationUrl,
            state: "st-9",
          }),
        ),
        awaitOAuth: vi.fn(async (): Promise<OAuthAwaitResult | null> => {
          seenMidFlight = getPendingConnectorAuth();
          return { ok: true, sessionId: "st-9", integration: "gmail" };
        }),
      });
      await installConnector(ops, GMAIL);
      expect(seenMidFlight).toEqual({ authorizationUrl, state: "st-9" });
      expect(getPendingConnectorAuth()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      setDevFlagsAllowed(false);
    }
  });

  it("never holds the pending consent without the emulate flag", async () => {
    let seenMidFlight: PendingConnectorAuth | null = { authorizationUrl: "sentinel", state: "s" };
    const ops = fakeOps({
      oauthStart: vi.fn(
        async (): Promise<OAuthStartResult> => ({
          status: "redirect",
          authorizationUrl: "https://accounts.google.com/consent",
          state: "st-2",
        }),
      ),
      awaitOAuth: vi.fn(async (): Promise<OAuthAwaitResult | null> => {
        seenMidFlight = getPendingConnectorAuth();
        return { ok: true, sessionId: "st-2", integration: "gmail" };
      }),
    });
    await installConnector(ops, GMAIL);
    expect(seenMidFlight).toBeNull();
  });

  it("polls through empty awaits until the callback fires", async () => {
    const awaitOAuth = vi
      .fn<(state: string) => Promise<OAuthAwaitResult | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: true, sessionId: "st-3", integration: "gmail" });
    const ops = fakeOps({
      oauthStart: vi.fn(
        async (): Promise<OAuthStartResult> => ({
          status: "redirect",
          authorizationUrl: "https://accounts.google.com/consent",
          state: "st-3",
        }),
      ),
      awaitOAuth,
    });
    await installConnector(ops, GMAIL);
    expect(awaitOAuth).toHaveBeenCalledTimes(3);
    // Every poll waits the interval first (the browser round-trip is never
    // instant), so the delay count matches the poll count.
    expect(ops.waitMs).toHaveBeenCalledTimes(3);
  });

  it("replaces a dead v1 googleDiscovery orphan before re-adding as a bundle", async () => {
    const ops = fakeOps({
      listIntegrations: vi.fn(async () => [
        integration({ slug: "gmail", kind: "googleDiscovery", canRefresh: false }),
      ]),
    });
    await installConnector(ops, GMAIL);
    expect(ops.removeIntegration).toHaveBeenCalledWith("gmail");
    expect(ops.addOpenApiIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "gmail" }),
    );
    expect(ops.oauthStart).toHaveBeenCalled();
  });

  it("resumes a live google integration without consent: skips creation, runs OAuth only", async () => {
    const ops = fakeOps({
      listIntegrations: vi.fn(async () => [integration({ slug: "gmail", kind: "openapi" })]),
    });
    await installConnector(ops, GMAIL);
    expect(ops.addOpenApiIntegration).not.toHaveBeenCalled();
    expect(ops.oauthStart).toHaveBeenCalled();
    // Consent failure on a pre-existing integration must not delete it — only
    // integrations this call created are rolled back (asserted below).
  });

  it("rolls back the created integration when consent fails (denied callback)", async () => {
    const ops = fakeOps({
      oauthStart: vi.fn(
        async (): Promise<OAuthStartResult> => ({
          status: "redirect",
          authorizationUrl: "https://accounts.google.com/consent",
          state: "st-2",
        }),
      ),
      awaitOAuth: vi.fn(
        async (): Promise<OAuthAwaitResult | null> => ({
          ok: false,
          sessionId: "st-2",
          error: "access_denied",
        }),
      ),
    });
    await expect(installConnector(ops, GMAIL)).rejects.toThrow(/OAuth failed/);
    expect(ops.removeIntegration).toHaveBeenCalledWith("gmail");
  });

  it("does not roll back a pre-existing integration when consent fails", async () => {
    const ops = fakeOps({
      listIntegrations: vi.fn(async () => [integration({ slug: "gmail", kind: "openapi" })]),
      oauthStart: vi.fn(async (): Promise<OAuthStartResult> => {
        throw new Error("OAuth client not found: google");
      }),
    });
    await expect(installConnector(ops, GMAIL)).rejects.toThrow(/OAuth client not found/);
    expect(ops.removeIntegration).not.toHaveBeenCalled();
  });
});

describe("installConnector — MCP", () => {
  it("declares the oauth2 method, registers a DCR client, then runs consent", async () => {
    const ops = fakeOps();
    await installConnector(ops, GITHUB);
    expect(ops.addMcpIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "github", auth: { kind: "oauth2" } }),
    );
    expect(ops.oauthProbe).toHaveBeenCalledWith("https://api.githubcopilot.com/mcp/");
    expect(ops.registerOAuthClientDynamic).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationEndpoint: "https://as.example/register",
        originIntegration: "github",
      }),
    );
    expect(ops.oauthStart).toHaveBeenCalledWith(
      expect.objectContaining({ client: "minted", integration: "github", template: "oauth2" }),
    );
  });

  it("reuses a previously minted DCR client for the same integration", async () => {
    const ops = fakeOps({
      listOAuthClients: vi.fn(
        async (): Promise<ExecutorOAuthClient[]> => [
          {
            owner: "user",
            slug: "github-old",
            grant: "authorization_code",
            authorizationUrl: "https://as.example/authorize",
            tokenUrl: "https://as.example/token",
            clientId: "cid",
            origin: { kind: "dynamic_client_registration", integration: "github" },
          },
        ],
      ),
    });
    await installConnector(ops, GITHUB);
    expect(ops.registerOAuthClientDynamic).not.toHaveBeenCalled();
    expect(ops.oauthStart).toHaveBeenCalledWith(expect.objectContaining({ client: "github-old" }));
  });

  it("fails (and rolls back) when the server offers no dynamic registration", async () => {
    const ops = fakeOps({
      oauthProbe: vi.fn(
        async (): Promise<OAuthProbeResult> => ({
          authorizationUrl: "https://as.example/authorize",
          tokenUrl: "https://as.example/token",
        }),
      ),
    });
    await expect(installConnector(ops, GITHUB)).rejects.toThrow(/automatic client registration/);
    expect(ops.removeIntegration).toHaveBeenCalledWith("github");
  });

  it("stores an API key as a header-template connection", async () => {
    const ops = fakeOps();
    await installConnector(ops, HUGGINGFACE);
    expect(ops.addMcpIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "huggingface",
        auth: { kind: "header", headerName: "Authorization", prefix: "Bearer " },
      }),
    );
    expect(ops.createConnection).toHaveBeenCalledWith({
      owner: "user",
      name: DEFAULT_CONNECTION_NAME,
      integration: "huggingface",
      template: "header",
      value: "hf_token",
    });
  });

  it("creates a none-template connection for an open server (tools need one)", async () => {
    const ops = fakeOps();
    const req: ConnectorInstallRequest = {
      source: { type: "mcp", name: "X", slug: "x", endpoint: "https://e" },
      auth: { kind: "none" },
    };
    await installConnector(ops, req);
    expect(ops.createConnection).toHaveBeenCalledWith({
      owner: "user",
      name: DEFAULT_CONNECTION_NAME,
      integration: "x",
      template: "none",
      values: {},
    });
  });

  it("rolls back the integration when the connection can't be created", async () => {
    const ops = fakeOps({
      createConnection: vi.fn(async (): Promise<ExecutorConnection> => {
        throw new Error("boom");
      }),
    });
    await expect(installConnector(ops, HUGGINGFACE)).rejects.toThrow("boom");
    expect(ops.removeIntegration).toHaveBeenCalledWith("huggingface");
  });
});

describe("installConnector — guards", () => {
  it("registers an OpenAPI integration from a custom request", async () => {
    const ops = fakeOps();
    const req: ConnectorInstallRequest = {
      source: {
        type: "openapi",
        name: "Petstore",
        slug: "petstore",
        specUrl: "https://x/spec",
        baseUrl: "https://x",
      },
      auth: { kind: "none" },
    };
    await installConnector(ops, req);
    expect(ops.addOpenApiIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "petstore",
        baseUrl: "https://x",
        spec: { kind: "url", url: "https://x/spec" },
      }),
    );
  });

  it("refuses to install over a slug that already has an integration, untouched", async () => {
    const ops = fakeOps({
      listIntegrations: vi.fn(async () => [integration({ slug: "x" })]),
    });
    const req: ConnectorInstallRequest = {
      source: { type: "mcp", name: "X", slug: "x", endpoint: "https://e" },
      auth: { kind: "oauth" },
    };
    await expect(installConnector(ops, req)).rejects.toThrow(/already installed/);
    expect(ops.addMcpIntegration).not.toHaveBeenCalled();
    expect(ops.oauthStart).not.toHaveBeenCalled();
    expect(ops.removeIntegration).not.toHaveBeenCalled();
  });

  it("aborts (fails closed) when the integration list can't be fetched", async () => {
    const ops = fakeOps({
      listIntegrations: vi.fn(async (): Promise<ExecutorIntegration[]> => {
        throw new Error("daemon down");
      }),
    });
    await expect(installConnector(ops, HUGGINGFACE)).rejects.toThrow("daemon down");
    expect(ops.addMcpIntegration).not.toHaveBeenCalled();
    expect(ops.createConnection).not.toHaveBeenCalled();
  });

  it("rejects a concurrent install of the same slug (re-entrancy guard)", async () => {
    // addMcpIntegration hangs on this deferred so the first install stays in flight.
    let resolveAdd!: (v: { slug: string }) => void;
    const pending = new Promise<{ slug: string }>((resolve) => {
      resolveAdd = resolve;
    });
    const ops = fakeOps({ addMcpIntegration: vi.fn(() => pending) });
    const req: ConnectorInstallRequest = {
      source: { type: "mcp", name: "X", slug: "x", endpoint: "https://e" },
      auth: { kind: "none" },
    };
    const first = installConnector(ops, req);
    await expect(installConnector(ops, req)).rejects.toThrow(/in progress/);
    resolveAdd({ slug: "x" });
    await first;
  });

  it("releases the guard after completion so the slug can install again", async () => {
    const ops = fakeOps();
    const req: ConnectorInstallRequest = {
      source: { type: "mcp", name: "X", slug: "x", endpoint: "https://e" },
      auth: { kind: "none" },
    };
    await installConnector(ops, req);
    await expect(installConnector(ops, req)).resolves.toBeUndefined();
  });
});

describe("uninstallConnector", () => {
  it("removes the integration, then every connection bound to it", async () => {
    const ops = fakeOps({
      listConnections: vi.fn(async () => [
        conn({ integration: "github", name: "default" }),
        conn({ integration: "github", name: "work", owner: "user" }),
        conn({ integration: "linear", name: "default" }),
      ]),
    });
    await uninstallConnector(ops, { slug: "github" });
    expect(ops.removeIntegration).toHaveBeenCalledWith("github");
    expect(ops.removeConnection).toHaveBeenCalledTimes(2);
    expect(ops.removeConnection).toHaveBeenCalledWith({
      owner: "user",
      integration: "github",
      name: "default",
    });
    expect(ops.removeConnection).toHaveBeenCalledWith({
      owner: "user",
      integration: "github",
      name: "work",
    });
  });

  it("does not remove connections when integration removal fails (leaves it intact)", async () => {
    const ops = fakeOps({
      removeIntegration: vi.fn(async (): Promise<{ removed: boolean }> => {
        throw new Error("integration boom");
      }),
      listConnections: vi.fn(async () => [conn({ integration: "x" })]),
    });
    await expect(uninstallConnector(ops, { slug: "x" })).rejects.toThrow("integration boom");
    expect(ops.removeConnection).not.toHaveBeenCalled();
  });

  it("surfaces a connection-list failure (and still removed the integration)", async () => {
    const ops = fakeOps({
      listConnections: vi.fn(async (): Promise<ExecutorConnection[]> => {
        throw new Error("list down");
      }),
    });
    await expect(uninstallConnector(ops, { slug: "github" })).rejects.toThrow("list down");
    expect(ops.removeIntegration).toHaveBeenCalledWith("github");
  });

  it("skips connection removal when nothing is bound to the integration", async () => {
    const ops = fakeOps();
    await uninstallConnector(ops, { slug: "none" });
    expect(ops.removeConnection).not.toHaveBeenCalled();
  });

  it("keeps removing later connections when one removal fails, then surfaces the error", async () => {
    const ops = fakeOps({
      listConnections: vi.fn(async () => [
        conn({ integration: "github", name: "a" }),
        conn({ integration: "github", name: "b" }),
      ]),
      removeConnection: vi
        .fn<
          (key: {
            owner: "org" | "user";
            integration: string;
            name: string;
          }) => Promise<{ removed: boolean }>
        >()
        .mockRejectedValueOnce(new Error("conn boom"))
        .mockResolvedValueOnce({ removed: true }),
    });
    await expect(uninstallConnector(ops, { slug: "github" })).rejects.toThrow("conn boom");
    // The later cleanup step ran despite the earlier failure.
    expect(ops.removeConnection).toHaveBeenCalledTimes(2);
  });
});
