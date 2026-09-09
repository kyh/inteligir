import { describe, expect, it, vi } from "vitest";

import { composeSessionMcpServers } from "../session-servers";

const OAUTH_ROW = {
  authorizationEndpoint: "https://auth.example.com/authorize",
  clientId: "client-1",
  kind: "oauth" as const,
  scopes: ["read"],
  tokenEndpoint: "https://auth.example.com/token",
  url: "https://mcp.example.com/sse",
};

describe("composeSessionMcpServers", () => {
  it("maps the three transport kinds, oauth carrying its live bearer", async () => {
    const servers = await composeSessionMcpServers(
      {
        enabledForSessions: () => [
          { name: "local", transport: { args: ["--x"], command: "srv", kind: "stdio" } },
          {
            name: "hosted",
            transport: {
              headers: { "X-K": "v" },
              kind: "http",
              url: "https://mcp.example.com/http",
            },
          },
          { name: "linear", transport: OAUTH_ROW },
        ],
      },
      { freshAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("tok-123") },
    );
    expect(servers).toEqual([
      { args: ["--x"], command: "srv", kind: "stdio", name: "local" },
      {
        headers: { "X-K": "v" },
        kind: "http",
        name: "hosted",
        url: "https://mcp.example.com/http",
      },
      {
        headers: { Authorization: "Bearer tok-123" },
        kind: "http",
        name: "linear",
        url: "https://mcp.example.com/sse",
      },
    ]);
  });

  it("EXCLUDES an oauth row with no live token instead of injecting a 401", async () => {
    const servers = await composeSessionMcpServers(
      {
        enabledForSessions: () => [
          { name: "linear", transport: OAUTH_ROW },
          { name: "local", transport: { args: [], command: "srv", kind: "stdio" } },
        ],
      },
      { freshAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue(null) },
    );
    expect(servers).toEqual([{ args: [], command: "srv", kind: "stdio", name: "local" }]);
  });

  it("omits the headers key entirely for a plain http row without any", async () => {
    const servers = await composeSessionMcpServers(
      {
        enabledForSessions: () => [
          { name: "plain", transport: { kind: "http", url: "https://mcp.example.com/h" } },
        ],
      },
      { freshAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue(null) },
    );
    expect(servers[0] !== undefined && "headers" in servers[0]).toBe(false);
  });
});
