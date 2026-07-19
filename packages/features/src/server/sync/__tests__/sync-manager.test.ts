// Adapter-only tests for the node platform bindings of @repo/domain's SyncEngine.
// The heavy reconcile+execute orchestration is tested in @repo/domain
// (src/sync/__tests__/engine.test.ts); the base store's own load/save/corrupt
// contract is tested in @repo/domain (src/sync/__tests__/base-store.test.ts);
// here we only pin the node-specific ports: the fs-backed JsonFile the base
// store wraps, the VaultManager→SyncIo adapter, the filesystem-safe clock,
// and the node-crypto hasher.

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
import type { VaultManifest } from "@repo/domain/sync/manifest";

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
  it("returns null before anything is saved (no anchor yet)", () => {
    const store = createJsonBaseStore(VAULT_ID, { path: path.join(tmp, "base.json") });
    expect(store.load()).toBeNull();
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

  it("returns the persisted manifest as-is even when scoped to a different vaultId — the engine, not the store, guards against a foreign anchor (engine.ts loadBase)", () => {
    const basePath = path.join(tmp, "base.json");
    const manifest: VaultManifest = { vaultId: VAULT_ID, generation: 1, files: [] };
    createJsonBaseStore(VAULT_ID, { path: basePath }).save(manifest);
    expect(createJsonBaseStore("other-vault", { path: basePath }).load()).toEqual(manifest);
  });

  it("degrades to null (re-sync from empty) on an old enveloped base file — never throws", () => {
    // Desktop base files predating this refactor carried a
    // {version, vaultId, generation, files} envelope. The lifted store
    // persists the bare manifest, so an old file either still parses (the
    // extra `version` key is tolerated — parseVaultManifest ignores unknown
    // keys) or fails validation and the store starts from empty. Either way
    // it must not throw.
    const basePath = path.join(tmp, "old-envelope.json");
    fs.writeFileSync(
      basePath,
      JSON.stringify({ version: 1, vaultId: VAULT_ID, generation: 2, files: [] }),
      "utf8",
    );
    const store = createJsonBaseStore(VAULT_ID, { path: basePath });
    expect(() => store.load()).not.toThrow();
    const loaded = store.load();
    if (loaded !== null) {
      expect(loaded).toEqual({ vaultId: VAULT_ID, generation: 2, files: [] });
    }
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

  it("lists every file uncapped — the data-loss regression pin", () => {
    // Historically vault.list() capped its listing (2000 entries, long gone).
    // Feeding any capped/truncated list into the sync engine reads the
    // missing tail as local deletions and propagates them to the coordinator
    // and every peer. createVaultSyncIo must see EVERY non-ignored file
    // (listAllPaths) — this pins that, cap or no cap.
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
