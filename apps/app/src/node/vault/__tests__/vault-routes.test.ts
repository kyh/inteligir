// The vault API surface over the composed app: contract row → handler →
// service → disk, plus the ws invalidation a mutation must produce.

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { apiErrorResponseSchema } from "@repo/server-contract/routes";
import {
  VAULT_MAX_CONTENT_LENGTH,
  vaultReadResponseSchema,
  vaultStatusResponseSchema,
  vaultTreeResponseSchema,
  vaultWriteConflictSchema,
} from "@repo/server-contract/vault";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { createKnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import { unavailableTurnDriver } from "../../threads/turn-driver";
import { WsBus, type BusSocket } from "../../ws-bus";
import { createVaultRuntime } from "../vault-runtime";
import { contentHash } from "../vault-service";
import { hermeticGitEnv } from "./git-test-env";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

async function bootVaultApp() {
  const instanceDir = mkdtempSync(join(tmpdir(), "inteligir-vault-routes-"));
  cleanups.push(() => rmSync(instanceDir, { recursive: true, force: true }));
  const dataDir = join(instanceDir, "data");
  const vaultDir = join(instanceDir, "vault");
  mkdirSync(dataDir, { recursive: true });
  const db = createConnection(join(dataDir, "inteligir.db"));
  runMigrations(db);
  const bus = new WsBus({ version: "0.1.0-test" });
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
  const knowledge = createKnowledgeRuntime({
    dataDir,
    vault: vault.service,
    vaultRoot: vaultDir,
  });
  cleanups.push(() => knowledge.dispose());
  const { app } = createApp({
    bus,
    createTurnDriver: () => unavailableTurnDriver,
    db,
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
    fallback: { kind: "none" },
    knowledge,
    schemaVersion: getSchemaVersion(db),
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
    // The service reports its PHYSICAL root (symlinks resolved) — on macOS
    // tmpdir() itself is spelled through /var → /private/var.
    expect(parsedTree.root).toBe(realpathSync(vaultDir));
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

    const oversized = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "big.md", content: "x".repeat(VAULT_MAX_CONTENT_LENGTH + 1) }),
    );
    expect(oversized.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await oversized.json()).error).toBe("invalid_request");
  });

  it("refuses a vault nested in the data dir at composition time", async () => {
    const instanceDir = mkdtempSync(join(tmpdir(), "inteligir-vault-routes-"));
    cleanups.push(() => rmSync(instanceDir, { recursive: true, force: true }));
    await expect(
      createVaultRuntime({
        vaultDir: join(instanceDir, "vault"),
        vaultRemote: null,
        dataDir: instanceDir,
        notifier: new WsBus({ version: "0.1.0-test" }),
        watch: false,
        syncIntervalMs: null,
        gitEnv: hermeticGitEnv(),
      }),
    ).rejects.toThrow(/must be disjoint/);
  });

  it("renames and deletes through the API", async () => {
    const { app } = await bootVaultApp();
    await app.request("/api/v1/vault/file", jsonRequest("PUT", { path: "old.md", content: "x" }));

    const rename = await app.request(
      "/api/v1/vault/rename",
      jsonRequest("POST", { from: "old.md", to: "nested/new.md" }),
    );
    expect(rename.status).toBe(200);
    expect(await rename.json()).toEqual({ path: "nested/new.md", rewritten: [], skipped: [] });

    const remove = await app.request(
      "/api/v1/vault/delete",
      jsonRequest("POST", { path: "nested/new.md" }),
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ ok: true });
  });

  it("applies a compare-and-swap write whose hash matches, refuses a stale one with current", async () => {
    const { app } = await bootVaultApp();
    await app.request("/api/v1/vault/file", jsonRequest("PUT", { path: "cas.md", content: "v1" }));
    const v1Hash = contentHash("v1");

    const applied = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "cas.md", content: "v2", expectedHash: v1Hash }),
    );
    expect(applied.status).toBe(200);

    const stale = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "cas.md", content: "v3", expectedHash: v1Hash }),
    );
    expect(stale.status).toBe(409);
    const refused = vaultWriteConflictSchema.parse(await stale.json());
    expect(refused.error).toBe("cas_mismatch");
    expect(refused.current).toEqual({ content: "v2", hash: contentHash("v2") });

    const missing = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "ghost.md", content: "x", expectedHash: v1Hash }),
    );
    expect(missing.status).toBe(409);
    const ghostRefusal = vaultWriteConflictSchema.parse(await missing.json());
    expect(ghostRefusal.error).toBe("cas_mismatch");
    expect(ghostRefusal.current).toBeUndefined();
  });

  it("honors create-exclusive writes and refuses both guards together", async () => {
    const { app } = await bootVaultApp();
    const created = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "fresh.md", content: "new", ifAbsent: true }),
    );
    expect(created.status).toBe(200);

    const exists = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", { path: "fresh.md", content: "clobber", ifAbsent: true }),
    );
    expect(exists.status).toBe(409);
    expect(vaultWriteConflictSchema.parse(await exists.json()).error).toBe("already_exists");

    const both = await app.request(
      "/api/v1/vault/file",
      jsonRequest("PUT", {
        path: "fresh.md",
        content: "x",
        ifAbsent: true,
        expectedHash: contentHash("new"),
      }),
    );
    expect(both.status).toBe(400);
  });

  it("creates folders through the API and refuses a file-shadowed one", async () => {
    const { app } = await bootVaultApp();

    const created = await app.request(
      "/api/v1/vault/mkdir",
      jsonRequest("POST", { path: "projects/ideas" }),
    );
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ path: "projects/ideas" });

    const tree = await app.request("/api/v1/vault/tree");
    const parsedTree = vaultTreeResponseSchema.parse(await tree.json());
    expect(parsedTree.entries).toContainEqual({ kind: "dir", path: "projects/ideas" });

    await app.request("/api/v1/vault/file", jsonRequest("PUT", { path: "note.md", content: "x" }));
    const shadowed = await app.request(
      "/api/v1/vault/mkdir",
      jsonRequest("POST", { path: "note.md" }),
    );
    expect(shadowed.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await shadowed.json()).error).toBe("conflict");
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
