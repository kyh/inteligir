// The connector surface over a FAKE codex: a scripted runner standing in for
// the binary, so the suite asserts on the argv this product composes and the
// refusals it derives — never on the developer's own ~/.codex/config.toml.
//
// The two facts worth a test are both about codex being permissive where this
// product must not be: `add` overwrites an existing name and exits 0, and
// `remove` of an unknown name prints a line and exits 0. Both read as success
// to anything that only checks the exit code.

import {
  connectorsMutationResponseSchema,
  connectorsResponseSchema,
} from "@repo/server-contract/connectors";
import { describe, expect, it } from "vitest";
import { CodexMcpError, parseCodexMcpList, type CodexMcpRunner } from "../codex-mcp";
import {
  ConnectorConflictError,
  ConnectorsUnavailableError,
  createConnectorsService,
} from "../connectors-service";
import { bootTestApp } from "../../__tests__/boot-app";

/** Codex's own listing shape, as much of it as this product reads. */
interface CodexServerFixture {
  name: string;
  enabled?: boolean;
  transport: Record<string, unknown>;
  auth_status?: string | null;
}

const CONFIGURED: readonly CodexServerFixture[] = [
  {
    name: "context7",
    enabled: true,
    transport: {
      type: "streamable_http",
      url: "https://mcp.context7.com/mcp",
      bearer_token_env_var: null,
    },
    auth_status: "not_logged_in",
  },
  {
    name: "files",
    enabled: false,
    transport: { type: "stdio", command: "npx", args: ["-y", "server-files"], env: null },
    auth_status: null,
  },
];

interface FakeRunner extends CodexMcpRunner {
  readonly calls: string[][];
}

/** A codex that answers `list` from a mutable store and records every argv. */
function fakeCodex(options: { binary?: string | null; rawList?: string } = {}): FakeRunner {
  const calls: string[][] = [];
  let servers: CodexServerFixture[] = CONFIGURED.map((server) => ({ ...server }));
  return {
    calls,
    binaryPath: () => (options.binary === undefined ? "/usr/local/bin/codex" : options.binary),
    run: async (_binary, args) => {
      calls.push([...args]);
      const verb = args[1];
      const name = args[2] ?? "";
      if (verb === "list") {
        return options.rawList ?? JSON.stringify(servers);
      }
      if (verb === "add") {
        // Codex OVERWRITES rather than refusing; the fake does the same, so
        // the duplicate test is testing this product's guard.
        servers = [
          ...servers.filter((server) => server.name !== name),
          { name, transport: { type: "stdio", command: "echo" } },
        ];
        return `Added global MCP server '${name}'.\n`;
      }
      if (verb === "remove") {
        servers = servers.filter((server) => server.name !== name);
        return `Removed global MCP server '${name}'.\n`;
      }
      throw new CodexMcpError(`unexpected argv: ${args.join(" ")}`);
    },
  };
}

describe("reading codex's listing", () => {
  it("keeps both transports and carries codex's own auth word", () => {
    expect(parseCodexMcpList(JSON.stringify(CONFIGURED))).toEqual([
      {
        name: "context7",
        enabled: true,
        transport: { kind: "http", url: "https://mcp.context7.com/mcp" },
        authStatus: "not_logged_in",
      },
      {
        name: "files",
        enabled: false,
        transport: { kind: "stdio", command: "npx", args: ["-y", "server-files"] },
        authStatus: null,
      },
    ]);
  });

  it("keeps a server whose transport this build has never heard of", () => {
    // Dropping it would hide a server the agent still talks to.
    expect(
      parseCodexMcpList(JSON.stringify([{ name: "future", transport: { type: "quantum" } }])),
    ).toEqual([
      {
        name: "future",
        enabled: true,
        transport: { kind: "other", summary: "quantum" },
        authStatus: null,
      },
    ]);
  });

  it("refuses a payload it cannot read rather than answering an empty list", () => {
    expect(() => parseCodexMcpList("not json")).toThrow(CodexMcpError);
    expect(() => parseCodexMcpList(JSON.stringify({ servers: [] }))).toThrow(CodexMcpError);
  });
});

describe("the connectors service", () => {
  it("answers unavailable — never empty — when no codex is installed", async () => {
    const service = createConnectorsService(fakeCodex({ binary: null }));
    const listed = await service.list();

    expect(listed.state).toBe("unavailable");
    expect(connectorsResponseSchema.parse(listed)).toEqual(listed);
    await expect(service.remove("context7")).rejects.toBeInstanceOf(ConnectorsUnavailableError);
  });

  it("answers unavailable when codex is there but says something unreadable", async () => {
    const service = createConnectorsService(fakeCodex({ rawList: "<html>" }));

    expect(await service.list()).toMatchObject({ state: "unavailable" });
  });

  it("puts the command after `--`, so a command that looks like a flag stays one", async () => {
    const runner = fakeCodex();
    await createConnectorsService(runner).add({
      name: "files2",
      transport: { kind: "stdio", command: "--url", args: ["/notes"] },
    });

    expect(runner.calls[1]).toEqual(["mcp", "add", "files2", "--", "--url", "/notes"]);
  });

  it("refuses a name codex would silently overwrite", async () => {
    const runner = fakeCodex();

    await expect(
      createConnectorsService(runner).add({
        name: "context7",
        transport: { kind: "http", url: "https://elsewhere.test/mcp" },
      }),
    ).rejects.toBeInstanceOf(ConnectorConflictError);
    // The read happened; nothing was written.
    expect(runner.calls.map((call) => call[1])).toEqual(["list"]);
  });

  it("refuses removing a name codex would shrug at", async () => {
    const runner = fakeCodex();

    await expect(createConnectorsService(runner).remove("nope")).rejects.toBeInstanceOf(
      ConnectorConflictError,
    );
    expect(runner.calls.map((call) => call[1])).toEqual(["list"]);
  });

  it("answers the new listing read back from codex, not the request echoed", async () => {
    const servers = await createConnectorsService(fakeCodex()).remove("files");

    expect(servers.map((server) => server.name)).toEqual(["context7"]);
  });
});

describe("the connector routes", () => {
  it("lists over the wire in the contract's shape", async () => {
    const app = await bootTestApp({ codexMcpRunner: fakeCodex() });
    const response = await app.client.connectors.$get();

    expect(response.status).toBe(200);
    expect(connectorsResponseSchema.parse(await response.json())).toMatchObject({ state: "ready" });
  });

  it("400s a name codex itself would refuse, before any process runs", async () => {
    const runner = fakeCodex();
    const app = await bootTestApp({ codexMcpRunner: runner });
    const response = await app.client.connectors.add.$post({
      json: { name: "a b", transport: { kind: "stdio", command: "echo", args: [] } },
    });

    expect(response.status).toBe(400);
    expect(runner.calls).toEqual([]);
  });

  it("409s a duplicate and 404s a removal of nothing", async () => {
    const app = await bootTestApp({ codexMcpRunner: fakeCodex() });

    const duplicate = await app.client.connectors.add.$post({
      json: { name: "context7", transport: { kind: "http", url: "https://elsewhere.test/mcp" } },
    });
    expect(duplicate.status).toBe(409);

    const missing = await app.client.connectors.remove.$post({ json: { name: "ghost" } });
    expect(missing.status).toBe(404);
  });

  it("503s a write when no codex is installed, and says why", async () => {
    const app = await bootTestApp({ codexMcpRunner: fakeCodex({ binary: null }) });
    const response = await app.client.connectors.remove.$post({ json: { name: "context7" } });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "provider_unavailable" });
  });

  it("hands the caller the new listing, so the next render needs no re-read", async () => {
    const app = await bootTestApp({ codexMcpRunner: fakeCodex() });
    const response = await app.client.connectors.add.$post({
      json: { name: "notes", transport: { kind: "stdio", command: "echo", args: ["hi"] } },
    });

    expect(response.status).toBe(200);
    const body = connectorsMutationResponseSchema.parse(await response.json());
    expect(body.servers.map((server) => server.name)).toContain("notes");
  });

  it("refuses a URL codex would store and then never connect to", async () => {
    const app = await bootTestApp({ codexMcpRunner: fakeCodex() });
    const response = await app.client.connectors.add.$post({
      json: { name: "typo", transport: { kind: "http", url: "notaurl" } },
    });

    expect(response.status).toBe(400);
  });
});
