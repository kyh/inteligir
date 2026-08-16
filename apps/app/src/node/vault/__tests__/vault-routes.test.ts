// The vault API surface over the composed app: contract row → handler →
// service → disk, plus the ws invalidation a mutation must produce.

import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { apiErrorResponseSchema } from "@repo/server-contract/routes";
import {
  vaultReadResponseSchema,
  vaultStatusResponseSchema,
  vaultTreeResponseSchema,
} from "@repo/server-contract/vault";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { WsBus, type BusSocket } from "../../ws-bus";
import { createVaultRuntime } from "../vault-runtime";
import { hermeticGitEnv } from "./git-test-env";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

async function bootVaultApp() {
  const dataDir = mkdtempSync(join(tmpdir(), "inteligir-vault-routes-"));
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const db = createConnection(join(dataDir, "inteligir.db"));
  runMigrations(db);
  const bus = new WsBus({ version: "0.1.0-test" });
  const vaultDir = join(dataDir, "vault");
  const vault = await createVaultRuntime({
    vaultDir,
    vaultRemote: null,
    dataDir,
    notifier: bus,
    watch: false,
    syncIntervalMs: null,
    gitEnv: hermeticGitEnv(),
  });
  cleanups.push(() => vault.dispose());
  const { app } = createApp({
    bus,
    config: {
      databasePath: join(dataDir, "inteligir.db"),
      dataDir,
      dataDirSource: "env",
      mode: "dev",
      port: 0,
      portSource: "env",
      vaultDir,
      vaultRemote: null,
    },
    db,
    fallback: { kind: "none" },
    startedAt: Date.now(),
    vault,
    version: "0.1.0-test",
  });
  return { app, bus, vaultDir };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("the vault routes", () => {
  it("writes through the API onto disk, lists and reads it back", async () => {
    const { app, vaultDir } = await bootVaultApp();

    const write = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "notes/api.md", content: "# via API\n" }),
    );
    expect(write.status).toBe(200);
    expect(await readFile(join(vaultDir, "notes", "api.md"), "utf8")).toBe("# via API\n");

    const tree = await app.request("/api/v1/vault/tree");
    expect(tree.status).toBe(200);
    const parsedTree = vaultTreeResponseSchema.parse(await tree.json());
    expect(parsedTree.root).toBe(vaultDir);
    expect(parsedTree.entries).toEqual([
      { kind: "dir", path: "notes" },
      { kind: "file", path: "notes/api.md", size: 10 },
      { kind: "file", path: "Welcome.md", size: expect.any(Number) },
    ]);

    const read = await app.request("/api/v1/vault/file?path=notes%2Fapi.md");
    expect(read.status).toBe(200);
    expect(vaultReadResponseSchema.parse(await read.json())).toEqual({
      path: "notes/api.md",
      content: "# via API\n",
    });
  });

  it("answers refusals with their declared statuses", async () => {
    const { app } = await bootVaultApp();

    const miss = await app.request("/api/v1/vault/file?path=nope.md");
    expect(miss.status).toBe(404);
    expect(apiErrorResponseSchema.parse(await miss.json()).error).toBe("not_found");

    const traversal = await app.request("/api/v1/vault/file?path=..%2Fescape.md");
    expect(traversal.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await traversal.json()).error).toBe("invalid_path");

    const gitReach = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: ".git/config", content: "evil" }),
    );
    expect(gitReach.status).toBe(400);

    await app.request("/api/v1/vault/file", jsonRequest("PUT", { path: "a.md", content: "a" }));
    await app.request("/api/v1/vault/file", jsonRequest("PUT", { path: "b.md", content: "b" }));
    const clobber = await app.request(
      "/api/v1/vault/rename",
      jsonRequest("POST", { from: "a.md", to: "b.md" }),
    );
    expect(clobber.status).toBe(409);

    const removeMiss = await app.request(
      "/api/v1/vault/delete",
      jsonRequest("POST", { path: "ghost.md" }),
    );
    expect(removeMiss.status).toBe(404);
  });

  it("renames and deletes through the API", async () => {
    const { app } = await bootVaultApp();
    await app.request("/api/v1/vault/file", jsonRequest("PUT", { path: "old.md", content: "x" }));

    const rename = await app.request(
      "/api/v1/vault/rename",
      jsonRequest("POST", { from: "old.md", to: "nested/new.md" }),
    );
    expect(rename.status).toBe(200);
    expect(await rename.json()).toEqual({ path: "nested/new.md" });

    const remove = await app.request(
      "/api/v1/vault/delete",
      jsonRequest("POST", { path: "nested/new.md" }),
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ ok: true });
  });

  it("answers status and sync-now as no-remote when no remote is configured", async () => {
    const { app } = await bootVaultApp();

    const status = await app.request("/api/v1/vault/status");
    expect(status.status).toBe(200);
    expect(vaultStatusResponseSchema.parse(await status.json()).state).toBe("no-remote");

    const sync = await app.request("/api/v1/vault/sync", { method: "POST" });
    expect(sync.status).toBe(200);
    expect(vaultStatusResponseSchema.parse(await sync.json()).state).toBe("no-remote");
  });

  it("fans a mutation out to vault subscribers on the ws bus", async () => {
    const { app, bus } = await bootVaultApp();
    const frames: string[] = [];
    const socket: BusSocket = {
      close: () => {},
      readyState: 1,
      send: (data) => frames.push(data),
    };
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "vault" });

    await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "notify.md", content: "ping" }),
    );
    const sawVaultChange = frames
      .map((frame): unknown => JSON.parse(frame))
      .some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          "type" in frame &&
          frame.type === "changed" &&
          "entity" in frame &&
          frame.entity === "vault",
      );
    expect(sawVaultChange).toBe(true);
  });
});
