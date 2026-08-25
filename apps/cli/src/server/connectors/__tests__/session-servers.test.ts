import { describe, expect, it } from "vitest";

import { composeSessionMcpServers } from "../session-servers";

const OAUTH_ROW = {
  kind: "oauth" as const,
  url: "https://mcp.example.com/sse",
  authorizationEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  clientId: "client-1",
  scopes: ["read"],
};

describe("composeSessionMcpServers", () => {
  it("maps the three transport kinds, oauth carrying its live bearer", async () => {
    const servers = await composeSessionMcpServers(
      {
        enabledForSessions: () => [
          { name: "local", transport: { kind: "stdio", command: "srv", args: ["--x"] } },
          {
            name: "hosted",
            transport: {
              kind: "http",
              url: "https://mcp.example.com/http",
              headers: { "X-K": "v" },
            },
          },
          { name: "linear", transport: OAUTH_ROW },
        ],
      },
      { freshAccessToken: () => Promise.resolve("tok-123") },
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
          { name: "local", transport: { kind: "stdio", command: "srv", args: [] } },
        ],
      },
      { freshAccessToken: () => Promise.resolve(null) },
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
      { freshAccessToken: () => Promise.resolve(null) },
    );
    expect(servers[0] !== undefined && "headers" in servers[0]).toBe(false);
  });
});
