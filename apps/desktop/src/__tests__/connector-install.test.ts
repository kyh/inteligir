import { describe, expect, it, vi } from "vitest";

import { CONNECTOR_CATALOG } from "@/renderer/settings/extensions/connector-catalog";
import {
  catalogInstallRequest,
  DEFAULT_CONNECTION_NAME,
  installConnector,
  uninstallConnector,
  type InstallRequest,
} from "@/renderer/settings/extensions/connector-install";
import {
  GOOGLE_OAUTH_CLIENT_SLUG,
  type ExecutorConnection,
  type ExecutorIntegration,
} from "@repo/core/executor";
import type { DesktopBridge } from "@repo/core/ipc";

function connector(id: string) {
  const c = CONNECTOR_CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`no catalog connector ${id}`);
  return c;
}

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

function mockBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    listExecutorIntegrations: vi.fn().mockResolvedValue([]),
    listExecutorConnections: vi.fn().mockResolvedValue([]),
    addMcpIntegration: vi.fn().mockResolvedValue({ slug: "x" }),
    addOpenApiIntegration: vi.fn().mockResolvedValue({ slug: "x", toolCount: 1 }),
    addGraphqlIntegration: vi.fn().mockResolvedValue({ slug: "x", name: "X" }),
    removeExecutorIntegration: vi.fn().mockResolvedValue({ removed: true }),
    createExecutorConnection: vi.fn().mockResolvedValue(conn({})),
    removeExecutorConnection: vi.fn().mockResolvedValue({ removed: true }),
    listExecutorOAuthClients: vi.fn().mockResolvedValue([]),
    registerExecutorOAuthClientDynamic: vi.fn().mockResolvedValue({ client: "minted" }),
    executorOAuthProbe: vi.fn().mockResolvedValue({
      authorizationUrl: "https://as.example/authorize",
      tokenUrl: "https://as.example/token",
      registrationEndpoint: "https://as.example/register",
    }),
    // runOAuthFlow returns immediately on an inline ("connected") completion.
    executorOAuthStart: vi.fn().mockResolvedValue({ status: "connected", connection: conn({}) }),
    executorOpenExternal: vi.fn().mockResolvedValue(undefined),
    executorOAuthAwait: vi.fn(),
    ...overrides,
  } as unknown as DesktopBridge;
}

describe("catalogInstallRequest", () => {
  it("maps an OAuth MCP connector", () => {
    const req = catalogInstallRequest(connector("github"));
    expect(req.source).toMatchObject({ type: "mcp", slug: "github" });
    expect(req.auth).toEqual({ kind: "oauth" });
  });

  it("maps an API-key connector with the supplied secret value", () => {
    const req = catalogInstallRequest(connector("huggingface"), "hf_token");
    expect(req.source.type).toBe("mcp");
    expect(req.auth).toMatchObject({
      kind: "apiKey",
      headerName: "Authorization",
      prefix: "Bearer ",
      value: "hf_token",
    });
  });

  it("maps a Google connector to a discovery-bundle source with Google OAuth", () => {
    const req = catalogInstallRequest(connector("gmail"));
    expect(req.source).toMatchObject({ type: "google", slug: "gmail" });
    expect(req.auth).toEqual({ kind: "google" });
  });

  it("throws when an API-key connector is mapped without a secret value", () => {
    expect(() => catalogInstallRequest(connector("huggingface"))).toThrow(/secret value/);
  });
});

describe("installConnector — Google", () => {
  it("registers a discovery-bundle integration then runs the consent flow", async () => {
    const bridge = mockBridge();
    await installConnector(bridge, catalogInstallRequest(connector("gmail")));
    expect(bridge.addOpenApiIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "gmail",
        spec: {
          kind: "googleDiscoveryBundle",
          urls: ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest"],
        },
      }),
    );
    expect(bridge.executorOAuthStart).toHaveBeenCalledWith(
      expect.objectContaining({
        client: GOOGLE_OAUTH_CLIENT_SLUG,
        integration: "gmail",
        template: "googleOAuth2",
        owner: "user",
        name: DEFAULT_CONNECTION_NAME,
      }),
    );
    // The OAuth flow mints the connection — no explicit create.
    expect(bridge.createExecutorConnection).not.toHaveBeenCalled();
  });

  it("surfaces the consent URL in the browser and resolves once the callback lands", async () => {
    const bridge = mockBridge({
      executorOAuthStart: vi.fn().mockResolvedValue({
        status: "redirect",
        authorizationUrl: "https://accounts.google.com/consent",
        state: "st-1",
      }),
      executorOAuthAwait: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: "st-1",
        integration: "gmail",
        identityLabel: "user@example.com",
      }),
    });
    await installConnector(bridge, catalogInstallRequest(connector("gmail")));
    expect(bridge.executorOpenExternal).toHaveBeenCalledWith("https://accounts.google.com/consent");
    expect(bridge.executorOAuthAwait).toHaveBeenCalledWith("st-1");
    expect(bridge.removeExecutorIntegration).not.toHaveBeenCalled();
  });

  it("replaces a dead v1 googleDiscovery orphan before re-adding as a bundle", async () => {
    const bridge = mockBridge({
      listExecutorIntegrations: vi
        .fn()
        .mockResolvedValue([
          integration({ slug: "gmail", kind: "googleDiscovery", canRefresh: false }),
        ]),
    });
    await installConnector(bridge, catalogInstallRequest(connector("gmail")));
    expect(bridge.removeExecutorIntegration).toHaveBeenCalledWith("gmail");
    expect(bridge.addOpenApiIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "gmail" }),
    );
    expect(bridge.executorOAuthStart).toHaveBeenCalled();
  });

  it("resumes a live google integration without consent: skips creation, runs OAuth only", async () => {
    const bridge = mockBridge({
      listExecutorIntegrations: vi
        .fn()
        .mockResolvedValue([integration({ slug: "gmail", kind: "openapi" })]),
    });
    await installConnector(bridge, catalogInstallRequest(connector("gmail")));
    expect(bridge.addOpenApiIntegration).not.toHaveBeenCalled();
    expect(bridge.executorOAuthStart).toHaveBeenCalled();
    // Consent failure on a pre-existing integration must not delete it — only
    // integrations this call created are rolled back (asserted below).
  });

  it("rolls back the created integration when consent fails (denied callback)", async () => {
    const bridge = mockBridge({
      executorOAuthStart: vi.fn().mockResolvedValue({
        status: "redirect",
        authorizationUrl: "https://accounts.google.com/consent",
        state: "st-2",
      }),
      executorOAuthAwait: vi
        .fn()
        .mockResolvedValue({ ok: false, sessionId: "st-2", error: "access_denied" }),
    });
    await expect(
      installConnector(bridge, catalogInstallRequest(connector("gmail"))),
    ).rejects.toThrow(/OAuth failed/);
    expect(bridge.removeExecutorIntegration).toHaveBeenCalledWith("gmail");
  });

  it("does not roll back a pre-existing integration when consent fails", async () => {
    const bridge = mockBridge({
      listExecutorIntegrations: vi
        .fn()
        .mockResolvedValue([integration({ slug: "gmail", kind: "openapi" })]),
      executorOAuthStart: vi.fn().mockRejectedValue(new Error("OAuth client not found: google")),
    });
    await expect(
      installConnector(bridge, catalogInstallRequest(connector("gmail"))),
    ).rejects.toThrow(/OAuth client not found/);
    expect(bridge.removeExecutorIntegration).not.toHaveBeenCalled();
  });
});

describe("installConnector — MCP", () => {
  it("declares the oauth2 method, registers a DCR client, then runs consent", async () => {
    const bridge = mockBridge();
    await installConnector(bridge, catalogInstallRequest(connector("github")));
    expect(bridge.addMcpIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "github", auth: { kind: "oauth2" } }),
    );
    expect(bridge.executorOAuthProbe).toHaveBeenCalledWith("https://api.githubcopilot.com/mcp/");
    expect(bridge.registerExecutorOAuthClientDynamic).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationEndpoint: "https://as.example/register",
        originIntegration: "github",
      }),
    );
    expect(bridge.executorOAuthStart).toHaveBeenCalledWith(
      expect.objectContaining({ client: "minted", integration: "github", template: "oauth2" }),
    );
  });

  it("reuses a previously minted DCR client for the same integration", async () => {
    const bridge = mockBridge({
      listExecutorOAuthClients: vi.fn().mockResolvedValue([
        {
          owner: "user",
          slug: "github-old",
          grant: "authorization_code",
          authorizationUrl: "https://as.example/authorize",
          tokenUrl: "https://as.example/token",
          clientId: "cid",
          origin: { kind: "dynamic_client_registration", integration: "github" },
        },
      ]),
    });
    await installConnector(bridge, catalogInstallRequest(connector("github")));
    expect(bridge.registerExecutorOAuthClientDynamic).not.toHaveBeenCalled();
    expect(bridge.executorOAuthStart).toHaveBeenCalledWith(
      expect.objectContaining({ client: "github-old" }),
    );
  });

  it("fails (and rolls back) when the server offers no dynamic registration", async () => {
    const bridge = mockBridge({
      executorOAuthProbe: vi.fn().mockResolvedValue({
        authorizationUrl: "https://as.example/authorize",
        tokenUrl: "https://as.example/token",
      }),
    });
    await expect(
      installConnector(bridge, catalogInstallRequest(connector("github"))),
    ).rejects.toThrow(/automatic client registration/);
    expect(bridge.removeExecutorIntegration).toHaveBeenCalledWith("github");
  });

  it("stores an API key as a header-template connection", async () => {
    const bridge = mockBridge();
    await installConnector(bridge, catalogInstallRequest(connector("huggingface"), "hf_token"));
    expect(bridge.addMcpIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "huggingface",
        auth: { kind: "header", headerName: "Authorization", prefix: "Bearer " },
      }),
    );
    expect(bridge.createExecutorConnection).toHaveBeenCalledWith({
      owner: "user",
      name: DEFAULT_CONNECTION_NAME,
      integration: "huggingface",
      template: "header",
      value: "hf_token",
    });
  });

  it("creates a none-template connection for an open server (tools need one)", async () => {
    const bridge = mockBridge();
    const req: InstallRequest = {
      source: { type: "mcp", name: "X", slug: "x", endpoint: "https://e" },
      auth: { kind: "none" },
    };
    await installConnector(bridge, req);
    expect(bridge.createExecutorConnection).toHaveBeenCalledWith({
      owner: "user",
      name: DEFAULT_CONNECTION_NAME,
      integration: "x",
      template: "none",
      values: {},
    });
  });

  it("rolls back the integration when the connection can't be created", async () => {
    const bridge = mockBridge({
      createExecutorConnection: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await expect(
      installConnector(bridge, catalogInstallRequest(connector("huggingface"), "hf_token")),
    ).rejects.toThrow("boom");
    expect(bridge.removeExecutorIntegration).toHaveBeenCalledWith("huggingface");
  });
});

describe("installConnector — guards", () => {
  it("registers an OpenAPI integration from a custom request", async () => {
    const bridge = mockBridge();
    const req: InstallRequest = {
      source: {
        type: "openapi",
        name: "Petstore",
        slug: "petstore",
        specUrl: "https://x/spec",
        baseUrl: "https://x",
      },
      auth: { kind: "none" },
    };
    await installConnector(bridge, req);
    expect(bridge.addOpenApiIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "petstore",
        baseUrl: "https://x",
        spec: { kind: "url", url: "https://x/spec" },
      }),
    );
  });

  it("refuses to install over a slug that already has an integration, untouched", async () => {
    const bridge = mockBridge({
      listExecutorIntegrations: vi.fn().mockResolvedValue([integration({ slug: "x" })]),
    });
    const req: InstallRequest = {
      source: { type: "mcp", name: "X", slug: "x", endpoint: "https://e" },
      auth: { kind: "oauth" },
    };
    await expect(installConnector(bridge, req)).rejects.toThrow(/already installed/);
    expect(bridge.addMcpIntegration).not.toHaveBeenCalled();
    expect(bridge.executorOAuthStart).not.toHaveBeenCalled();
    expect(bridge.removeExecutorIntegration).not.toHaveBeenCalled();
  });

  it("aborts (fails closed) when the integration list can't be fetched", async () => {
    const bridge = mockBridge({
      listExecutorIntegrations: vi.fn().mockRejectedValue(new Error("daemon down")),
    });
    await expect(
      installConnector(bridge, catalogInstallRequest(connector("huggingface"), "hf_token")),
    ).rejects.toThrow("daemon down");
    expect(bridge.addMcpIntegration).not.toHaveBeenCalled();
    expect(bridge.createExecutorConnection).not.toHaveBeenCalled();
  });

  it("rejects a concurrent install of the same slug", async () => {
    // addMcpIntegration hangs on this deferred so the first install stays in flight.
    let resolveAdd!: (v: { slug: string }) => void;
    const pending = new Promise<{ slug: string }>((resolve) => {
      resolveAdd = resolve;
    });
    const bridge = mockBridge({ addMcpIntegration: vi.fn(() => pending) });
    const req: InstallRequest = {
      source: { type: "mcp", name: "X", slug: "x", endpoint: "https://e" },
      auth: { kind: "none" },
    };
    const first = installConnector(bridge, req);
    await expect(installConnector(bridge, req)).rejects.toThrow(/in progress/);
    resolveAdd({ slug: "x" });
    await first;
  });
});

describe("uninstallConnector", () => {
  it("removes the integration, then every connection bound to it", async () => {
    const bridge = mockBridge({
      listExecutorConnections: vi
        .fn()
        .mockResolvedValue([
          conn({ integration: "github", name: "default" }),
          conn({ integration: "github", name: "work", owner: "user" }),
          conn({ integration: "linear", name: "default" }),
        ]),
    });
    await uninstallConnector(bridge, { slug: "github" });
    expect(bridge.removeExecutorIntegration).toHaveBeenCalledWith("github");
    expect(bridge.removeExecutorConnection).toHaveBeenCalledTimes(2);
    expect(bridge.removeExecutorConnection).toHaveBeenCalledWith({
      owner: "user",
      integration: "github",
      name: "default",
    });
    expect(bridge.removeExecutorConnection).toHaveBeenCalledWith({
      owner: "user",
      integration: "github",
      name: "work",
    });
  });

  it("does not remove connections when integration removal fails (leaves it intact)", async () => {
    const bridge = mockBridge({
      removeExecutorIntegration: vi.fn().mockRejectedValue(new Error("integration boom")),
      listExecutorConnections: vi.fn().mockResolvedValue([conn({ integration: "x" })]),
    });
    await expect(uninstallConnector(bridge, { slug: "x" })).rejects.toThrow("integration boom");
    expect(bridge.removeExecutorConnection).not.toHaveBeenCalled();
  });

  it("surfaces a connection-list failure (and still removed the integration)", async () => {
    const bridge = mockBridge({
      listExecutorConnections: vi.fn().mockRejectedValue(new Error("list down")),
    });
    await expect(uninstallConnector(bridge, { slug: "github" })).rejects.toThrow("list down");
    expect(bridge.removeExecutorIntegration).toHaveBeenCalledWith("github");
  });

  it("skips connection removal when nothing is bound to the integration", async () => {
    const bridge = mockBridge();
    await uninstallConnector(bridge, { slug: "none" });
    expect(bridge.removeExecutorConnection).not.toHaveBeenCalled();
  });

  it("keeps removing later connections when one removal fails, then surfaces the error", async () => {
    const bridge = mockBridge({
      listExecutorConnections: vi
        .fn()
        .mockResolvedValue([
          conn({ integration: "github", name: "a" }),
          conn({ integration: "github", name: "b" }),
        ]),
      removeExecutorConnection: vi
        .fn()
        .mockRejectedValueOnce(new Error("conn boom"))
        .mockResolvedValueOnce({ removed: true }),
    });
    await expect(uninstallConnector(bridge, { slug: "github" })).rejects.toThrow("conn boom");
    // The later cleanup step ran despite the earlier failure.
    expect(bridge.removeExecutorConnection).toHaveBeenCalledTimes(2);
  });
});
