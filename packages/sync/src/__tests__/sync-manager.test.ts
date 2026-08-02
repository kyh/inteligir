// Adapter-only tests for the node platform bindings of @repo/notes's SyncEngine.
// The heavy reconcile+execute orchestration is tested in @repo/notes
// (src/sync/__tests__/engine.test.ts); the base store's own load/save/corrupt
// contract is tested in @repo/notes (src/sync/__tests__/base-store.test.ts);
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
import { VaultManager } from "@repo/vault/vault";
import type { StoredBase } from "@repo/notes/sync/base-store";

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

  it("round-trips a saved anchor across store instances (persisted to disk)", () => {
    const basePath = path.join(tmp, "base.json");
    const anchor: StoredBase = {
      vaultId: VAULT_ID,
      vaultRoot: path.join(tmp, "vault"),
      files: [{ path: "a.md", contentHash: sha256Hex("AAA"), version: 2, size: 3 }],
    };
    createJsonBaseStore(VAULT_ID, { path: basePath }).save(anchor);
    // A fresh store instance reads the persisted file back from disk.
    expect(createJsonBaseStore(VAULT_ID, { path: basePath }).load()).toEqual(anchor);
  });

  it("returns the persisted anchor as-is even when scoped to a different vaultId — the engine, not the store, guards against a foreign anchor (engine.ts loadBase)", () => {
    const basePath = path.join(tmp, "base.json");
    const anchor: StoredBase = { vaultId: VAULT_ID, vaultRoot: null, files: [] };
    createJsonBaseStore(VAULT_ID, { path: basePath }).save(anchor);
    expect(createJsonBaseStore("other-vault", { path: basePath }).load()).toEqual(anchor);
  });

  it("degrades to null (re-sync from empty) on an old enveloped base file — never throws", () => {
    // Base files on disk from older desktop builds carry a
    // {version, vaultId, generation, files} envelope. This store persists the
    // bare manifest, so such a file either still parses (the extra
    // `version`/`generation` keys are tolerated — parseVaultManifest ignores
    // unknown keys) or fails validation and the store starts from empty.
    // Either way it must not throw.
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
      expect(loaded).toEqual({ vaultId: VAULT_ID, vaultRoot: null, files: [] });
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
    // Feeding any capped or truncated listing into the sync engine reads the
    // missing tail as local deletions and propagates them to the coordinator
    // and every peer — silent, cross-device data loss. createVaultSyncIo must
    // see EVERY non-ignored file (listAllPaths); this pins that against any
    // cap a future vault listing might grow.
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

  it("reports the live vault root, following a repoint", () => {
    const vault = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: path.join(tmp, "vault"),
      manageAgentLink: false,
    });
    const io = createVaultSyncIo(vault);

    expect(io.root?.()).toBe(vault.getRoot());

    vault.setRoot(path.join(tmp, "second"));
    expect(io.root?.()).toBe(vault.getRoot());
  });

  // The crawl cannot read a symlink or a cloud-placeholder stub as a file, so
  // it reports what it could not account for and the ENGINE decides — it is the
  // only layer holding the base anchor, and a path that was never synced cannot
  // be deleted by leaving it out of a manifest.
  it("reports paths the crawl could not present as files", () => {
    const vault = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: path.join(tmp, "vault"),
      manageAgentLink: false,
    });
    vault.writeText("keep.md", "x");
    const root = fs.realpathSync(vault.getRoot());
    fs.symlinkSync(path.join(root, "keep.md"), path.join(root, "linked.md"));
    fs.writeFileSync(path.join(root, ".evicted.md.icloud"), "");

    const io = createVaultSyncIo(vault);

    expect([...io.list()].toSorted()).toEqual(["keep.md"]);
    expect(io.unaccounted?.()).toEqual(["evicted.md", "linked.md"]);
  });

  it("refuses to delete a path that resolves to a file this sync just wrote", () => {
    // Two names for one file — a hardlink here, a case-only rename on
    // APFS/NTFS. Removing the second name destroys the bytes the first write
    // landed, and the next pass reports that absence as a deletion to every
    // device.
    const vault = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: path.join(tmp, "vault"),
      manageAgentLink: false,
    });
    vault.ensureReady();
    const io = createVaultSyncIo(vault);
    io.write("a.md", new TextEncoder().encode("AAA"));
    fs.linkSync(path.join(vault.getRoot(), "a.md"), path.join(vault.getRoot(), "b.md"));

    expect(() => io.remove("b.md")).toThrow(/refusing to delete/);
    expect(new TextDecoder().decode(io.read("a.md"))).toBe("AAA");
  });

  it("still deletes the path it wrote, and any alias once that path is gone", () => {
    const vault = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: path.join(tmp, "vault"),
      manageAgentLink: false,
    });
    vault.ensureReady();
    const io = createVaultSyncIo(vault);
    io.write("a.md", new TextEncoder().encode("AAA"));
    fs.linkSync(path.join(vault.getRoot(), "a.md"), path.join(vault.getRoot(), "b.md"));

    io.remove("a.md");
    // The remembered inode now names a path that no longer exists — a stale
    // record must never veto a real delete.
    io.remove("b.md");

    expect([...io.list()]).toEqual([]);
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
