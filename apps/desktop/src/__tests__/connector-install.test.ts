import { describe, expect, it, vi } from "vitest";

import { CONNECTOR_CATALOG } from "@/renderer/shell/builtin/extensions/connector-catalog";
import {
  apiKeySecretId,
  catalogInstallRequest,
  installConnector,
  uninstallConnector,
  type InstallRequest,
} from "@/renderer/shell/builtin/extensions/connector-install";
import type { ExecutorConnectionRef } from "@/shared/executor";
import type { DesktopBridge } from "@/shared/ipc";

function connector(id: string) {
  const c = CONNECTOR_CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`no catalog connector ${id}`);
  return c;
}

function mockBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  const ok = { toolCount: 1, namespace: "ns" };
  return {
    addMcpSource: vi.fn().mockResolvedValue(ok),
    addOpenApiSource: vi.fn().mockResolvedValue(ok),
    addGraphqlSource: vi.fn().mockResolvedValue(ok),
    addGoogleSource: vi.fn().mockResolvedValue(ok),
    listExecutorSources: vi.fn().mockResolvedValue([]),
    setExecutorSecret: vi.fn().mockResolvedValue({ id: "s" }),
    removeExecutorSource: vi.fn().mockResolvedValue({ removed: true }),
    removeExecutorConnection: vi.fn().mockResolvedValue({ removed: true }),
    removeExecutorSecret: vi.fn().mockResolvedValue({ removed: true }),
    listExecutorConnections: vi.fn().mockResolvedValue([]),
    // runOAuthFlow returns immediately when start reports a completed connection.
    executorOAuthStart: vi
      .fn()
      .mockResolvedValue({ sessionId: "sess", authorizationUrl: null, completedConnection: { connectionId: "c" } }),
    executorOpenExternal: vi.fn().mockResolvedValue(undefined),
    executorOAuthAwait: vi.fn(),
    ...overrides,
  } as unknown as DesktopBridge;
}

function conn(over: Partial<ExecutorConnectionRef>): ExecutorConnectionRef {
  return {
    id: "id",
    scopeId: "scope",
    provider: "provider",
    identityLabel: null,
    expiresAt: null,
    oauthScope: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("catalogInstallRequest", () => {
  it("maps an OAuth MCP connector", () => {
    const req = catalogInstallRequest(connector("github"));
    expect(req.source).toMatchObject({ type: "mcp", namespace: "github" });
    expect(req.auth).toEqual({ kind: "oauth" });
  });

  it("maps an API-key connector with the supplied secret value", () => {
    const req = catalogInstallRequest(connector("huggingface"), "hf_token");
    expect(req.source.type).toBe("mcp");
    expect(req.auth).toMatchObject({
      kind: "apiKey",
      secretId: apiKeySecretId("huggingface"),
      secretValue: "hf_token",
    });
  });

  it("maps a Google connector to a google source with no auth", () => {
    const req = catalogInstallRequest(connector("gmail"));
    expect(req.source.type).toBe("google");
    expect(req.auth).toEqual({ kind: "none" });
  });

  it("throws when an API-key connector is mapped without a secret value", () => {
    expect(() => catalogInstallRequest(connector("huggingface"))).toThrow(/secret value/);
  });
});

describe("installConnector", () => {
  it("registers a Google discovery source without auth side-effects", async () => {
    const bridge = mockBridge();
    await installConnector(bridge, catalogInstallRequest(connector("gmail")));
    expect(bridge.addGoogleSource).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "gmail", auth: { kind: "none" } }),
    );
    expect(bridge.setExecutorSecret).not.toHaveBeenCalled();
    expect(bridge.executorOAuthStart).not.toHaveBeenCalled();
  });

  it("stores a secret then registers an MCP source with a secret-ref header", async () => {
    const bridge = mockBridge();
    await installConnector(bridge, catalogInstallRequest(connector("huggingface"), "hf_token"));
    expect(bridge.setExecutorSecret).toHaveBeenCalledWith(
      expect.objectContaining({ id: apiKeySecretId("huggingface"), value: "hf_token" }),
    );
    expect(bridge.addMcpSource).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "huggingface",
        headers: { Authorization: { secretId: apiKeySecretId("huggingface"), prefix: "Bearer " } },
      }),
    );
  });

  it("runs the OAuth flow before registering an OAuth MCP source", async () => {
    const bridge = mockBridge();
    await installConnector(bridge, catalogInstallRequest(connector("github")));
    expect(bridge.executorOAuthStart).toHaveBeenCalledOnce();
    expect(bridge.addMcpSource).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "github" }),
    );
  });

  it("registers an OpenAPI source from a custom request", async () => {
    const bridge = mockBridge();
    const req: InstallRequest = {
      source: { type: "openapi", name: "Petstore", namespace: "petstore", specUrl: "https://x/spec", baseUrl: "https://x" },
      auth: { kind: "none" },
    };
    await installConnector(bridge, req);
    expect(bridge.addOpenApiSource).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://x", spec: { kind: "url", url: "https://x/spec" } }),
    );
  });

  it("rolls back the secret when API-key source registration fails", async () => {
    const bridge = mockBridge({
      addMcpSource: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await expect(
      installConnector(bridge, catalogInstallRequest(connector("huggingface"), "hf_token")),
    ).rejects.toThrow("boom");
    expect(bridge.removeExecutorSecret).toHaveBeenCalledWith(apiKeySecretId("huggingface"));
  });

  it("rolls back the OAuth connection when source registration fails", async () => {
    const bridge = mockBridge({
      addMcpSource: vi.fn().mockRejectedValue(new Error("boom")),
      listExecutorConnections: vi.fn().mockResolvedValue([conn({ id: "mcp-oauth2-x", provider: "x" })]),
    });
    const req: InstallRequest = {
      source: { type: "mcp", name: "X", namespace: "x", endpoint: "https://e" },
      auth: { kind: "oauth" },
    };
    await expect(installConnector(bridge, req)).rejects.toThrow("boom");
    expect(bridge.removeExecutorConnection).toHaveBeenCalledWith("mcp-oauth2-x");
  });

  it("refuses to install over a namespace that already has a source, untouched", async () => {
    // A duplicate install must not re-run auth (overwriting the secret / OAuth
    // the existing source depends on) nor roll anything back.
    const bridge = mockBridge({
      listExecutorSources: vi.fn().mockResolvedValue([{ id: "x", name: "X", kind: "mcp" }]),
    });
    const req: InstallRequest = {
      source: { type: "mcp", name: "X", namespace: "x", endpoint: "https://e" },
      auth: { kind: "oauth" },
    };
    await expect(installConnector(bridge, req)).rejects.toThrow(/already installed/);
    expect(bridge.executorOAuthStart).not.toHaveBeenCalled();
    expect(bridge.setExecutorSecret).not.toHaveBeenCalled();
    expect(bridge.addMcpSource).not.toHaveBeenCalled();
    expect(bridge.removeExecutorConnection).not.toHaveBeenCalled();
  });

  it("aborts (fails closed) without touching auth when the source list can't be fetched", async () => {
    const bridge = mockBridge({
      listExecutorSources: vi.fn().mockRejectedValue(new Error("daemon down")),
    });
    await expect(
      installConnector(bridge, catalogInstallRequest(connector("huggingface"), "hf_token")),
    ).rejects.toThrow("daemon down");
    expect(bridge.setExecutorSecret).not.toHaveBeenCalled();
    expect(bridge.addMcpSource).not.toHaveBeenCalled();
  });

  it("rejects a concurrent install of the same namespace", async () => {
    // addMcpSource hangs on this deferred so the first install stays in flight.
    let resolveAdd!: (v: { toolCount: number; namespace: string }) => void;
    const pending = new Promise<{ toolCount: number; namespace: string }>((resolve) => {
      resolveAdd = resolve;
    });
    const bridge = mockBridge({ addMcpSource: vi.fn(() => pending) });
    const req: InstallRequest = {
      source: { type: "mcp", name: "X", namespace: "x", endpoint: "https://e" },
      auth: { kind: "none" },
    };
    const first = installConnector(bridge, req);
    await expect(installConnector(bridge, req)).rejects.toThrow(/in progress/);
    resolveAdd({ toolCount: 1, namespace: "x" });
    await first;
  });

  it("rolls back the OAuth connection when the auth flow itself fails", async () => {
    const bridge = mockBridge({
      // Flow proceeds to the browser + poll, then the callback reports failure —
      // by which point executor may already have created the connection.
      executorOAuthStart: vi
        .fn()
        .mockResolvedValue({ sessionId: "s", authorizationUrl: "https://auth", completedConnection: null }),
      executorOAuthAwait: vi.fn().mockResolvedValue({ ok: false, sessionId: "s", error: "denied" }),
      listExecutorConnections: vi.fn().mockResolvedValue([conn({ id: "mcp-oauth2-x", provider: "x" })]),
    });
    const req: InstallRequest = {
      source: { type: "mcp", name: "X", namespace: "x", endpoint: "https://e" },
      auth: { kind: "oauth" },
    };
    await expect(installConnector(bridge, req)).rejects.toThrow(/OAuth failed/);
    expect(bridge.addMcpSource).not.toHaveBeenCalled();
    expect(bridge.removeExecutorConnection).toHaveBeenCalledWith("mcp-oauth2-x");
  });
});

describe("uninstallConnector", () => {
  it("removes the source, its (freshly queried) OAuth connection, and the secret", async () => {
    const bridge = mockBridge({
      listExecutorConnections: vi.fn().mockResolvedValue([conn({ id: "mcp-oauth2-github" })]),
    });
    await uninstallConnector(bridge, {
      sourceId: "src-1",
      namespace: "github",
      secretId: apiKeySecretId("github"),
    });
    expect(bridge.removeExecutorSource).toHaveBeenCalledWith("src-1");
    expect(bridge.removeExecutorConnection).toHaveBeenCalledWith("mcp-oauth2-github");
    expect(bridge.removeExecutorSecret).toHaveBeenCalledWith(apiKeySecretId("github"));
  });

  it("ignores a connection that only matches by provider, not the namespaced id", async () => {
    const bridge = mockBridge({
      // Same provider label, but a different connector's connection id — must
      // not be removed.
      listExecutorConnections: vi.fn().mockResolvedValue([conn({ id: "mcp-oauth2-other", provider: "linear" })]),
    });
    await uninstallConnector(bridge, { sourceId: "src-1", namespace: "linear" });
    expect(bridge.removeExecutorConnection).not.toHaveBeenCalled();
  });

  it("surfaces a connection-list failure (and still removes the source)", async () => {
    const bridge = mockBridge({
      listExecutorConnections: vi.fn().mockRejectedValue(new Error("list down")),
    });
    await expect(
      uninstallConnector(bridge, { sourceId: "src-1", namespace: "github" }),
    ).rejects.toThrow("list down");
    expect(bridge.removeExecutorSource).toHaveBeenCalledWith("src-1");
  });

  it("skips connection and secret removal when there is nothing to remove", async () => {
    const bridge = mockBridge();
    await uninstallConnector(bridge, { sourceId: "src-1", namespace: "none" });
    expect(bridge.removeExecutorConnection).not.toHaveBeenCalled();
    expect(bridge.removeExecutorSecret).not.toHaveBeenCalled();
  });

  it("still removes the secret when connection removal fails, then surfaces the error", async () => {
    const bridge = mockBridge({
      listExecutorConnections: vi.fn().mockResolvedValue([conn({ id: "mcp-oauth2-github" })]),
      removeExecutorConnection: vi.fn().mockRejectedValue(new Error("conn boom")),
    });
    await expect(
      uninstallConnector(bridge, {
        sourceId: "src-1",
        namespace: "github",
        secretId: apiKeySecretId("github"),
      }),
    ).rejects.toThrow("conn boom");
    // The later cleanup step ran despite the earlier failure.
    expect(bridge.removeExecutorSecret).toHaveBeenCalledWith(apiKeySecretId("github"));
  });
});
