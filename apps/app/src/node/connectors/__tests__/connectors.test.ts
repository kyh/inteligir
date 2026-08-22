// The registry over a real temp store file. The facts worth pinning:
// redaction (no read ever carries a header value), the two refusals (409 on a
// duplicate add, 404 on an unknown name), header survival through an update
// that omits them, the malformed-file refusal (never read as empty — the next
// write would erase what the bytes held), and the session view carrying the
// full rows the redacted view must not.

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectorsResponseSchema } from "@repo/server-contract/connectors";
import { describe, expect, it } from "vitest";
import { ConnectorConflictError, createConnectorsService } from "../connectors-service";
import { ConnectorsStoreError, createConnectorsStore } from "../connectors-store";
import { bootTestApp } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";

function tempService() {
  const dir = makeTempDir("inteligir-connectors-");
  return { dir, service: createConnectorsService(createConnectorsStore(dir)) };
}

describe("the connectors registry", () => {
  it("adds, lists redacted, and hands sessions the full rows", () => {
    const { service } = tempService();
    service.add({
      name: "context7",
      transport: {
        headers: { CONTEXT7_API_KEY: "sk-secret" },
        kind: "http",
        url: "https://mcp.context7.com/mcp",
      },
    });
    const listed = service.list();
    expect(listed).toEqual([
      {
        enabled: true,
        name: "context7",
        transport: { hasAuth: true, kind: "http", url: "https://mcp.context7.com/mcp" },
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("sk-secret");

    const sessions = service.enabledForSessions();
    expect(sessions).toEqual([
      {
        name: "context7",
        transport: {
          headers: { CONTEXT7_API_KEY: "sk-secret" },
          kind: "http",
          url: "https://mcp.context7.com/mcp",
        },
      },
    ]);
  });

  it("refuses a duplicate add and an unknown remove/update/toggle", () => {
    const { service } = tempService();
    service.add({ name: "a", transport: { args: [], command: "srv", kind: "stdio" } });
    expect(() =>
      service.add({ name: "a", transport: { args: [], command: "other", kind: "stdio" } }),
    ).toThrowError(ConnectorConflictError);
    expect(() => service.remove("missing")).toThrowError(ConnectorConflictError);
    expect(() =>
      service.update({ name: "missing", transport: { kind: "http", url: "https://x.dev/mcp" } }),
    ).toThrowError(ConnectorConflictError);
    expect(() => service.toggle("missing", false)).toThrowError(ConnectorConflictError);
  });

  it("keeps stored headers through an update that omits them", () => {
    const { service } = tempService();
    service.add({
      name: "exa",
      transport: { headers: { "x-api-key": "k1" }, kind: "http", url: "https://mcp.exa.ai/mcp" },
    });
    service.update({ name: "exa", transport: { kind: "http", url: "https://mcp.exa.ai/v2/mcp" } });
    const [row] = service.enabledForSessions();
    expect(row?.transport).toEqual({
      headers: { "x-api-key": "k1" },
      kind: "http",
      url: "https://mcp.exa.ai/v2/mcp",
    });
  });

  it("a disabled row leaves the session view; toggling restores it", () => {
    const { service } = tempService();
    service.add({ name: "a", transport: { args: [], command: "srv", kind: "stdio" } });
    service.toggle("a", false);
    expect(service.enabledForSessions()).toEqual([]);
    service.toggle("a", true);
    expect(service.enabledForSessions()).toHaveLength(1);
  });

  it("writes the store at 0600 and refuses malformed bytes as an error, never as empty", () => {
    const { dir, service } = tempService();
    service.add({ name: "a", transport: { args: [], command: "srv", kind: "stdio" } });
    const path = join(dir, "connectors.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).servers).toHaveLength(1);

    writeFileSync(path, "{not json");
    expect(() => service.list()).toThrowError(ConnectorsStoreError);
  });
});

describe("the connector routes", () => {
  it("serves the registry with refusal statuses over the API", async () => {
    const harness = await bootTestApp();
    const added = await harness.client.connectors.add.$post({
      json: { name: "srv", transport: { args: ["run"], command: "npx", kind: "stdio" } },
    });
    expect(added.status).toBe(200);
    const duplicate = await harness.client.connectors.add.$post({
      json: { name: "srv", transport: { args: [], command: "x", kind: "stdio" } },
    });
    expect(duplicate.status).toBe(409);

    const listed = await harness.client.connectors.$get();
    expect(listed.status).toBe(200);
    const body = connectorsResponseSchema.parse(await listed.json());
    expect(body.servers.map((row) => row.name)).toEqual(["srv"]);

    const missing = await harness.client.connectors.remove.$post({ json: { name: "ghost" } });
    expect(missing.status).toBe(404);
  });
});
