import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { InMemorySyncPort } from "./in-memory-sync-port";
import { SyncManager, createVaultSyncIo } from "../sync-manager";
import { VaultManager } from "../../vault/vault";
import { conflictCopyName } from "@repo/core/sync/reconcile";

const VAULT_ID = "vault-1";
const FIXED_NOW = new Date("2026-07-05T12:34:56.000Z");
// Mirror SyncManager.stamp(): ISO with `:`/`.` swapped for filesystem safety.
const STAMP = FIXED_NOW.toISOString().replaceAll(":", "-").replace(".", "-");

let tmp: string;
let root: string;
let settingsPath: string;
let basePath: string;
let vault: VaultManager;
let port: InMemorySyncPort;

function newVault(): VaultManager {
  return new VaultManager({ settingsPath, defaultRoot: root, manageAgentLink: false });
}

function newManager(): SyncManager {
  return new SyncManager({
    vaultId: VAULT_ID,
    port,
    vault: createVaultSyncIo(vault),
    basePath,
    now: () => FIXED_NOW,
    debounceMs: 0,
  });
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function remoteText(p: string): Promise<string | null> {
  const got = await port.getFile(p);
  return got.ok ? decode(got.content) : null;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-test-"));
  root = path.join(tmp, "vault");
  settingsPath = path.join(tmp, "settings.json");
  basePath = path.join(tmp, "sync-base.json");
  vault = newVault();
  port = new InMemorySyncPort(VAULT_ID);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("SyncManager.syncOnce", () => {
  it("first sync pushes every local file to an empty coordinator", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");

    const out = await newManager().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 2, pulled: 0, deleted: 0, conflicts: 0 });
    const manifest = await port.listManifest();
    expect(manifest.files.map((f) => f.path).toSorted()).toEqual(["a.md", "notes/b.md"]);
    expect(await remoteText("a.md")).toBe("AAA");
    expect(await remoteText("notes/b.md")).toBe("BBB");
  });

  it("pulls a coordinator-only file into the local vault", async () => {
    await port.putFile("remote-only.md", encode("REMOTE"), 0);

    const out = await newManager().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 0, pulled: 1, deleted: 0, conflicts: 0 });
    expect(vault.readText("remote-only.md")).toBe("REMOTE");
  });

  it("is a no-op once both sides have converged", async () => {
    vault.writeText("a.md", "AAA");
    await newManager().syncOnce(); // converge + advance base

    const genAfterFirst = port.currentGeneration();
    // A fresh manager reads the persisted base — nothing should move.
    const out = await newManager().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 0, pulled: 0, deleted: 0, conflicts: 0 });
    expect(port.currentGeneration()).toBe(genAfterFirst); // no coordinator writes
  });

  it("resolves a both-sides edit: winner keeps the path, loser becomes a conflict copy", async () => {
    // 1. Establish a shared base at version 1.
    vault.writeText("note.md", "base");
    await newManager().syncOnce();

    // 2. Coordinator advances the file to v2 (a peer edit).
    const seenVersion = (await port.listManifest()).files.find(
      (f) => f.path === "note.md",
    )?.version;
    expect(seenVersion).toBe(1);
    const bumped = await port.putFile("note.md", encode("remote-wins"), 1);
    expect(bumped.ok).toBe(true);

    // 3. Local edits the same file since base → a true conflict.
    vault.writeText("note.md", "local-loser");

    const out = await newManager().syncOnce();

    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.conflicts).toBe(1);

    // Winner (remote, higher version) keeps the canonical path.
    expect(vault.readText("note.md")).toBe("remote-wins");
    expect(await remoteText("note.md")).toBe("remote-wins");

    // Loser's bytes are preserved beside it as a conflict copy, on BOTH sides.
    const copyPath = conflictCopyName("note.md", STAMP);
    expect(vault.readText(copyPath)).toBe("local-loser");
    expect(await remoteText(copyPath)).toBe("local-loser");

    // Base advanced: a follow-up pass sees a fully converged vault.
    const settled = await newManager().syncOnce();
    expect(settled).toEqual({ status: "ok", pushed: 0, pulled: 0, deleted: 0, conflicts: 0 });
  });

  it("mirrors a local delete to the coordinator", async () => {
    vault.writeText("gone.md", "bye");
    await newManager().syncOnce();
    expect(await remoteText("gone.md")).toBe("bye");

    vault.delete("gone.md");
    const out = await newManager().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 0, pulled: 0, deleted: 1, conflicts: 0 });
    expect(await remoteText("gone.md")).toBeNull();
  });

  it("reports an error (and leaves base untouched) when the coordinator vault mismatches", async () => {
    vault.writeText("a.md", "AAA");
    const wrong = new SyncManager({
      vaultId: "other-vault",
      port, // reports VAULT_ID
      vault: createVaultSyncIo(vault),
      basePath,
      now: () => FIXED_NOW,
      debounceMs: 0,
    });

    const out = await wrong.syncOnce();
    expect(out.status).toBe("error");
    // Nothing was pushed.
    expect((await port.listManifest()).files).toHaveLength(0);
  });
});
