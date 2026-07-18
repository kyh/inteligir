import { beforeEach, describe, expect, it } from "vitest";

import { InMemorySyncPort } from "./in-memory-sync-port";
import { SyncEngine, type Clock, type Hasher, type SyncIo, type SyncOutcome } from "../engine";
import { InMemoryBaseStore } from "../base-store";
import { InMemoryBaseBlobStore } from "../blob-store";
import { conflictCopyName } from "../reconcile";
import type { VaultPath } from "../vault-file";

const VAULT_ID = "vault-1";
const FIXED_ISO = "2026-07-05T12:34:56.000Z";
// Mirror the desktop's nodeStamp(): ISO with `:`/`.` swapped for filesystem safety.
const STAMP = FIXED_ISO.replaceAll(":", "-").replace(".", "-");

const enc = new TextEncoder();
const dec = new TextDecoder();

// Web Crypto (the WebWorker-lib global) keeps @repo/core node-free even in
// tests, and is the exact async digest the mobile client will inject. It must
// match the coordinator fake's hasher so equal bytes hash equal.
function webCryptoHasher(): Hasher {
  return async (bytes) => {
    // Copy into a fresh (non-shared) buffer so the type is `<ArrayBuffer>`, which
    // `BufferSource` requires — a plain Uint8Array may be SharedArrayBuffer-backed.
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
}

const fixedStamp: Clock = () => STAMP;

/** A Map-backed vault implementing the engine's `SyncIo`, plus text helpers. */
class MemoryVault {
  private readonly files = new Map<VaultPath, Uint8Array>();

  readonly io: SyncIo = {
    list: () => [...this.files.keys()].toSorted(),
    read: (path) => {
      const bytes = this.files.get(path);
      if (bytes === undefined) throw new Error(`MemoryVault: read of absent ${path}`);
      return bytes;
    },
    write: (path, content) => {
      this.files.set(path, new Uint8Array(content));
    },
    remove: (path) => {
      this.files.delete(path);
    },
  };

  writeText(path: string, text: string): void {
    this.files.set(path, enc.encode(text));
  }

  readText(path: string): string | null {
    const bytes = this.files.get(path);
    return bytes === undefined ? null : dec.decode(bytes);
  }

  delete(path: string): void {
    this.files.delete(path);
  }
}

function encode(text: string): Uint8Array {
  return enc.encode(text);
}

let vault: MemoryVault;
let base: InMemoryBaseStore;
let blobs: InMemoryBaseBlobStore;
let port: InMemorySyncPort;

// A fresh engine over the SHARED vault/base/blobs/port — two engines share the
// base store, so a second one reads the first's persisted anchor (like the
// desktop's two managers over one base file).
function newEngine(
  vaultId: string = VAULT_ID,
  onOutcome?: (outcome: SyncOutcome) => void,
): SyncEngine {
  return new SyncEngine({
    vaultId,
    port,
    io: vault.io,
    base,
    blobs,
    hash: webCryptoHasher(),
    stamp: fixedStamp,
    debounceMs: 0,
    onOutcome,
  });
}

async function remoteText(p: string): Promise<string | null> {
  const got = await port.getFile(p);
  return got.ok ? dec.decode(got.content) : null;
}

beforeEach(() => {
  vault = new MemoryVault();
  base = new InMemoryBaseStore();
  blobs = new InMemoryBaseBlobStore();
  port = new InMemorySyncPort(VAULT_ID);
});

describe("SyncEngine.syncOnce", () => {
  it("first sync pushes every local file to an empty coordinator", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");

    const out = await newEngine().syncOnce();

    expect(out).toEqual({
      status: "ok",
      pushed: 2,
      pulled: 0,
      deleted: 0,
      conflicts: 0,
      merged: 0,
      conflictPaths: [],
    });
    const manifest = await port.listManifest();
    expect(manifest.files.map((f) => f.path).toSorted()).toEqual(["a.md", "notes/b.md"]);
    expect(await remoteText("a.md")).toBe("AAA");
    expect(await remoteText("notes/b.md")).toBe("BBB");
  });

  it("pulls a coordinator-only file into the local vault", async () => {
    await port.putFile("remote-only.md", encode("REMOTE"), 0);

    const out = await newEngine().syncOnce();

    expect(out).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 1,
      deleted: 0,
      conflicts: 0,
      merged: 0,
      conflictPaths: [],
    });
    expect(vault.readText("remote-only.md")).toBe("REMOTE");
  });

  it("is a no-op once both sides have converged", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce(); // converge + advance base

    const genAfterFirst = port.currentGeneration();
    // A fresh engine reads the persisted base — nothing should move.
    const out = await newEngine().syncOnce();

    expect(out).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 0,
      deleted: 0,
      conflicts: 0,
      merged: 0,
      conflictPaths: [],
    });
    expect(port.currentGeneration()).toBe(genAfterFirst); // no coordinator writes
  });

  it("resolves a both-sides edit: winner keeps the path, loser becomes a conflict copy", async () => {
    // 1. Establish a shared base at version 1.
    vault.writeText("note.md", "base");
    await newEngine().syncOnce();

    // 2. Coordinator advances the file to v2 (a peer edit).
    const seenVersion = (await port.listManifest()).files.find(
      (f) => f.path === "note.md",
    )?.version;
    expect(seenVersion).toBe(1);
    const bumped = await port.putFile("note.md", encode("remote-wins"), 1);
    expect(bumped.ok).toBe(true);

    // 3. Local edits the same file since base → a true conflict.
    vault.writeText("note.md", "local-loser");

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    const copyPath = conflictCopyName("note.md", STAMP);
    if (out.status === "ok") {
      expect(out.conflicts).toBe(1);
      // The outcome NAMES the copy it created — what a conflict UI lists.
      expect(out.conflictPaths).toEqual([copyPath]);
    }

    // Winner (remote, higher version) keeps the canonical path.
    expect(vault.readText("note.md")).toBe("remote-wins");
    expect(await remoteText("note.md")).toBe("remote-wins");

    // Loser's bytes are preserved beside it as a conflict copy, on BOTH sides.
    expect(vault.readText(copyPath)).toBe("local-loser");
    expect(await remoteText(copyPath)).toBe("local-loser");

    // Base advanced: a follow-up pass sees a fully converged vault.
    const settled = await newEngine().syncOnce();
    expect(settled).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 0,
      deleted: 0,
      conflicts: 0,
      merged: 0,
      conflictPaths: [],
    });
  });

  it("mirrors a local delete to the coordinator", async () => {
    vault.writeText("gone.md", "bye");
    await newEngine().syncOnce();
    expect(await remoteText("gone.md")).toBe("bye");

    vault.delete("gone.md");
    const out = await newEngine().syncOnce();

    expect(out).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 0,
      deleted: 1,
      conflicts: 0,
      merged: 0,
      conflictPaths: [],
    });
    expect(await remoteText("gone.md")).toBeNull();
  });

  it("reports an error (and leaves base untouched) when the coordinator vault mismatches", async () => {
    vault.writeText("a.md", "AAA");
    // The engine syncs "other-vault" but the port reports VAULT_ID.
    const out = await newEngine("other-vault").syncOnce();

    expect(out.status).toBe("error");
    // Nothing was pushed.
    expect((await port.listManifest()).files).toHaveLength(0);
  });
});

describe("SyncEngine.scheduleSync (debounced) — onOutcome", () => {
  // Mirrors "resolves a both-sides edit" above, but the pass is triggered by
  // the internal debounce (scheduleSync/onVaultChanged) instead of an
  // explicit syncOnce() — a caller that never calls syncOnce() directly (a
  // remote-change subscription, a periodic timer) must still learn the
  // outcome, which is exactly what a platform's coordinator needs to surface
  // a background-pass conflict immediately.
  it("fires onOutcome with a debounced pass's conflict — no explicit syncOnce() call", async () => {
    // 1. Establish a shared base at version 1.
    vault.writeText("note.md", "base");
    await newEngine().syncOnce();

    // 2. Coordinator advances the file to v2 (a peer edit).
    const bumped = await port.putFile("note.md", encode("remote-wins"), 1);
    expect(bumped.ok).toBe(true);

    // 3. Local edits the same file since base → a true conflict, discovered
    // only through a debounced trigger (never `syncOnce()` directly).
    vault.writeText("note.md", "local-loser");

    const outcomes: SyncOutcome[] = [];
    let resolveSeen: (() => void) | null = null;
    const seen = new Promise<void>((resolve) => {
      resolveSeen = resolve;
    });
    const engine = newEngine(VAULT_ID, (outcome) => {
      outcomes.push(outcome);
      resolveSeen?.();
    });

    engine.onVaultChanged(); // the debounced path — NOT syncOnce()
    await seen;

    expect(outcomes).toHaveLength(1);
    const out = outcomes[0];
    expect(out?.status).toBe("ok");
    const copyPath = conflictCopyName("note.md", STAMP);
    if (out?.status === "ok") {
      expect(out.conflicts).toBe(1);
      expect(out.conflictPaths).toEqual([copyPath]);
    }
    expect(vault.readText("note.md")).toBe("remote-wins");
    expect(vault.readText(copyPath)).toBe("local-loser");
  });
});
