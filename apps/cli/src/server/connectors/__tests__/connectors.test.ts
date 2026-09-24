import { readFileSync, statSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { ORPCError, safe } from "@orpc/client";
import { connectorsResponseSchema } from "@repo/api/local/connectors/connectors-schema";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConnectorConflictError, createConnectorsService } from "../connectors-service";
import { ConnectorsStore } from "../connectors-store";
import { JsonFileStoreError } from "../../json-file-store";
import { bootTestApp, listenTestApp } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";
import { startFakeProvider } from "./fake-oauth-provider";

const storeFileSchema = z.object({ servers: z.array(z.unknown()) });

// the RPC protocol's error envelope, as far as a caller reads it.
const rpcErrorBodySchema = z.object({ json: z.object({ message: z.string() }) });

const readServersLength = (path: string): number =>
  storeFileSchema.parse(JSON.parse(readFileSync(path, "utf-8"))).servers.length;

const tempService = () => {
  const dir = makeTempDir("inteligir-connectors-");
  return { dir, service: createConnectorsService(new ConnectorsStore(dir)) };
};

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

  it("refuses a duplicate add and an unknown remove/toggle", () => {
    const { service } = tempService();
    service.add({ name: "a", transport: { args: [], command: "srv", kind: "stdio" } });
    expect(() =>
      service.add({ name: "a", transport: { args: [], command: "other", kind: "stdio" } }),
    ).toThrow(ConnectorConflictError);
    expect(() => service.remove("missing")).toThrow(ConnectorConflictError);
    expect(() => service.toggle("missing", false)).toThrow(ConnectorConflictError);
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
    const path = nodePath.join(dir, "connectors.json");
    expect(statSync(path).mode % 0o1000).toBe(0o600);
    expect(readServersLength(path)).toBe(1);

    writeFileSync(path, "{not json");
    expect(() => service.list()).toThrow(JsonFileStoreError);
  });
});

// assert the refusal class: `rejects.toThrow()` passes for the wrong refusal and for a crash.
describe("the connector procedures", () => {
  it("serves the registry with its refusal classes", async () => {
    const harness = await bootTestApp();
    const added = await harness.client.connectors.add({
      name: "srv",
      transport: { args: ["run"], command: "npx", kind: "stdio" },
    });
    expect(added.servers.map((row) => row.name)).toEqual(["srv"]);

    const [duplicate] = await safe(
      harness.client.connectors.add({
        name: "srv",
        transport: { args: [], command: "x", kind: "stdio" },
      }),
    );
    expect(duplicate instanceof ORPCError && duplicate.code).toBe("ALREADY_EXISTS");

    const body = connectorsResponseSchema.parse(await harness.client.connectors.list());
    expect(body.servers.map((row) => row.name)).toEqual(["srv"]);

    const [missing] = await safe(harness.client.connectors.remove({ name: "ghost" }));
    expect(missing instanceof ORPCError && missing.code).toBe("NOT_FOUND");
  });

  // the whole dance on a listening server: the callback it names is its own loopback address, and
  // the fake consent page's redirect lands on it the way a browser's would.
  it("adds a connector by its URL alone and completes OAuth against the provider it discovers", async () => {
    const provider = await startFakeProvider();
    const opened: string[] = [];
    const { client, port } = await listenTestApp(
      await bootTestApp({
        openExternalUrl: async (url) => {
          opened.push(url);
          return await Promise.resolve(true);
        },
      }),
    );
    await client.connectors.add({
      name: "linear",
      transport: { kind: "oauth", scopes: [], url: provider.mcpUrl },
    });

    const begun = await client.connectors.oauthBegin({ name: "linear", open: true });
    expect(opened).toEqual([begun.url]);
    const consent = await fetch(begun.url, { redirect: "manual" });
    const callback = consent.headers.get("location") ?? "";
    expect(callback).toContain(`127.0.0.1:${String(port)}/connectors/oauth/callback`);
    const landed = await fetch(callback);
    expect(landed.status).toBe(200);
    expect(await landed.text()).toContain("Connected");

    const { servers } = await client.connectors.list();
    expect(servers[0]?.transport).toMatchObject({ clientId: "dcr-1", status: "connected" });
  });

  it("says why when discovery finds nothing to authorize against", async () => {
    const provider = await startFakeProvider();
    provider.documents.clear();
    const { client } = await listenTestApp(await bootTestApp());
    await client.connectors.add({
      name: "bare",
      transport: { kind: "oauth", scopes: [], url: provider.mcpUrl },
    });

    const [refused] = await safe(client.connectors.oauthBegin({ name: "bare", open: false }));
    expect(refused instanceof ORPCError && refused.code).toBe("PROVIDER_UNAVAILABLE");
    expect(refused instanceof ORPCError && refused.message).toContain(
      "publishes no OAuth metadata",
    );
  });

  // over http, not the router client: the wire is where a bare 500 would lose the file's name.
  it("names a malformed store on the wire", async () => {
    const harness = await bootTestApp();
    const storePath = nodePath.join(harness.dataDir, "connectors.json");
    writeFileSync(storePath, "{");
    const response = await harness.request(`${RPC_PREFIX}/connectors/list`, {
      body: JSON.stringify({ json: {} }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(500);
    const body = rpcErrorBodySchema.parse(await response.json());
    expect(body.json.message).toContain(storePath);
  });
});
