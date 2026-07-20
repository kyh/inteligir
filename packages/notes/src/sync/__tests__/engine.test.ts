import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Web Crypto (the WebWorker-lib global) keeps @repo/notes node-free even in
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
    // A sibling survives the delete: an empty local listing against a
    // non-empty base is refused by the mass-deletion guard (#429, below).
    vault.writeText("gone.md", "bye");
    vault.writeText("stays.md", "here");
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
    expect(await remoteText("stays.md")).toBe("here");
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

// The DATA-LOSS guard (#429): a transient vault-read failure yields an empty
// local manifest, and reconcile would read every base path as a local delete —
// pushing a vault-wide deletion to the coordinator and every peer. The engine
// must refuse that pass outright. These tests are adversarial: they simulate
// the empty listing and assert ZERO ops reach the port and the base anchor is
// untouched, then pin the guard's edges (a genuinely empty first sync and a
// legitimate partial delete must NOT trip it).
describe("SyncEngine mass-deletion guard (#429)", () => {
  it("empty local listing + non-empty base → error, ZERO deletes reach the port, base untouched", async () => {
    // Converge two files so the base anchor records them.
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");
    await newEngine().syncOnce();
    const baseBefore = base.load();
    expect(baseBefore?.files).toHaveLength(2);
    const genBefore = port.currentGeneration();

    // The vault now lists NOTHING — indistinguishable from a truncated/failed
    // crawl (which is exactly why the engine must refuse).
    vault.delete("a.md");
    vault.delete("notes/b.md");
    const deleteSpy = vi.spyOn(port, "deleteFile");
    const putSpy = vi.spyOn(port, "putFile");

    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({
      status: "error",
      message: expect.stringContaining("mass deletion"),
    });
    // ZERO ops reached the coordinator — no deletes, no writes, no generation
    // bump; every remote file survives.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
    expect(port.currentGeneration()).toBe(genBefore);
    expect(await remoteText("a.md")).toBe("AAA");
    expect(await remoteText("notes/b.md")).toBe("BBB");
    // The base anchor is untouched, so the next pass retries from the same
    // clean 3-way anchor.
    expect(base.load()).toEqual(baseBefore);
  });

  it("the refusal is per-pass: files reappearing locally resume syncing", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce();
    vault.delete("a.md");
    expect((await newEngine().syncOnce()).status).toBe("error");

    // The vault comes back (remounted / restored) — the next pass converges
    // normally off the untouched base: nothing to push, nothing deleted.
    vault.writeText("a.md", "AAA");
    const out = await newEngine().syncOnce();
    expect(out).toMatchObject({ status: "ok", pushed: 0, deleted: 0 });
    expect(await remoteText("a.md")).toBe("AAA");
  });

  it("does NOT trip on a genuinely empty vault with an empty base (first sync)", async () => {
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
  });

  it("does NOT block a legitimate delete while other files remain", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("b.md", "BBB");
    await newEngine().syncOnce();

    vault.delete("a.md");
    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "ok", deleted: 1 });
    expect(await remoteText("a.md")).toBeNull();
    expect(await remoteText("b.md")).toBe("BBB");
  });

  it("a delete-ALL surfaces as the guard error (the deliberate trade), and an explicit re-confirm propagates it", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("b.md", "BBB");
    await newEngine().syncOnce();

    // The user really deletes everything — indistinguishable from a failed
    // crawl, so the engine refuses and the message explains how to proceed.
    vault.delete("a.md");
    vault.delete("b.md");
    const refused = await newEngine().syncOnce();
    expect(refused).toMatchObject({
      status: "error",
      message: expect.stringContaining("add any file"),
    });
    expect(await remoteText("a.md")).toBe("AAA");

    // The documented re-confirm: any local file makes the listing non-empty,
    // and the pending deletions then propagate as real ops.
    vault.writeText("keep.md", "still here");
    const confirmed = await newEngine().syncOnce();
    expect(confirmed).toMatchObject({ status: "ok", pushed: 1, deleted: 2 });
    expect(await remoteText("a.md")).toBeNull();
    expect(await remoteText("b.md")).toBeNull();
    expect(await remoteText("keep.md")).toBe("still here");
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
