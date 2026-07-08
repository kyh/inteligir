// Adapter-only tests for the node platform bindings of @repo/core's SyncEngine.
// The heavy reconcile+execute orchestration is tested in @repo/core
// (src/sync/__tests__/engine.test.ts); here we only pin the node-specific ports:
// the JsonStore-backed base store, the VaultManager→SyncIo adapter, the
// filesystem-safe clock, and the node-crypto hasher.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createJsonBaseStore,
  createNodeHasher,
  createVaultSyncIo,
  nodeStamp,
} from "../sync-manager";
import { VaultManager } from "../../vault/vault";
import type { VaultManifest } from "@repo/core/sync/manifest";

const VAULT_ID = "vault-1";

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(new TextEncoder().encode(text)).digest("hex");
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-adapter-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createJsonBaseStore", () => {
  it("loads an empty manifest before anything is saved", () => {
    const store = createJsonBaseStore(VAULT_ID, { path: path.join(tmp, "base.json") });
    expect(store.load()).toEqual({ vaultId: VAULT_ID, generation: 0, files: [] });
  });

  it("round-trips a saved manifest across store instances (persisted to disk)", () => {
    const basePath = path.join(tmp, "base.json");
    const manifest: VaultManifest = {
      vaultId: VAULT_ID,
      generation: 3,
      files: [{ path: "a.md", contentHash: sha256Hex("AAA"), version: 2, size: 3 }],
    };
    createJsonBaseStore(VAULT_ID, { path: basePath }).save(manifest);
    // A fresh store instance reads the persisted file back from disk.
    expect(createJsonBaseStore(VAULT_ID, { path: basePath }).load()).toEqual(manifest);
  });

  it("starts from empty when the persisted base belongs to a different vault", () => {
    const basePath = path.join(tmp, "base.json");
    createJsonBaseStore(VAULT_ID, { path: basePath }).save({
      vaultId: VAULT_ID,
      generation: 1,
      files: [],
    });
    // A store scoped to a different vault ignores the foreign anchor.
    expect(createJsonBaseStore("other-vault", { path: basePath }).load()).toEqual({
      vaultId: "other-vault",
      generation: 0,
      files: [],
    });
  });
});

describe("createVaultSyncIo", () => {
  it("lists, reads, writes, and removes vault files through a VaultManager", () => {
    const vault = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: path.join(tmp, "vault"),
      manageAgentLink: false,
    });
    const io = createVaultSyncIo(vault);

    io.write("a.md", new TextEncoder().encode("AAA"));
    io.write("notes/b.md", new TextEncoder().encode("BBB"));

    expect([...io.list()].toSorted()).toEqual(["a.md", "notes/b.md"]);
    expect(new TextDecoder().decode(io.read("a.md"))).toBe("AAA");

    io.remove("a.md");
    expect([...io.list()].toSorted()).toEqual(["notes/b.md"]);
  });

  it("lists every file uncapped — the data-loss regression pin (plan 001)", () => {
    // vault.list() caps at 2000 entries for the UI. Feeding that capped list
    // into the sync engine reads a truncated manifest as local deletions and
    // propagates them to the coordinator and every peer. createVaultSyncIo
    // must use the uncapped listAllPaths() instead.
    const vault = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: path.join(tmp, "vault"),
      manageAgentLink: false,
    });
    vault.ensureReady();
    const root = vault.getRoot();
    const TOTAL = 2050;
    for (let i = 0; i < TOTAL; i++) {
      fs.writeFileSync(path.join(root, `f${String(i).padStart(4, "0")}.md`), "x");
    }

    const io = createVaultSyncIo(vault);
    expect(io.list().length).toBe(TOTAL);
  });
});

describe("nodeStamp", () => {
  it("produces a filesystem-safe timestamp (no `:` or `.`)", () => {
    const stamp = nodeStamp(() => new Date("2026-07-05T12:34:56.000Z"));
    expect(stamp()).toBe("2026-07-05T12-34-56-000Z");
  });
});

describe("createNodeHasher", () => {
  it("hashes bytes to a lowercase sha-256 hex digest", async () => {
    const digest = await createNodeHasher()(new TextEncoder().encode("AAA"));
    expect(digest).toBe(sha256Hex("AAA"));
  });
});
