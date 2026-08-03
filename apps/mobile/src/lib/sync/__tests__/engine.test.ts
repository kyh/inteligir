import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonFileBaseStore } from "@repo/notes/sync/base-store";
import { InMemoryBaseBlobStore } from "@repo/notes/sync/blob-store";
import { SyncEngine } from "@repo/notes/sync/engine";
import { conflictCopyName } from "@repo/notes/sync/reconcile";
// The coordinator fake ships under core's `./sync/testing/*` subpath (test-only
// surface). It mints monotonic versions and honors optimistic concurrency
// exactly like the wire contract.
import { InMemorySyncPort } from "@repo/notes/sync/testing/in-memory-sync-port";

import { createFsStamp } from "../clock";
import { createSyncIo, VaultRootMissingError, type VaultFs } from "../sync-io";
import { fakeJsonFile, memVaultFs, webCryptoHasher } from "./fakes";

const VAULT_ID = "vault-1";
const FIXED_STAMP = createFsStamp(() => new Date("2026-07-05T12:34:56.000Z"));

let vault: ReturnType<typeof memVaultFs>;
let baseFile: ReturnType<typeof fakeJsonFile>;
let blobs: InMemoryBaseBlobStore;
let port: InMemorySyncPort;

// A fresh engine over the SHARED vault/base/blobs/port — two engines share the
// base store so a second one reads the first's persisted anchor (the mobile
// client rebuilds a fresh engine per pass over the same on-disk base).
function newEngine(fs: VaultFs = vault.fs): SyncEngine {
  return new SyncEngine({
    vaultId: VAULT_ID,
    port,
    io: createSyncIo(fs),
    base: createJsonFileBaseStore(baseFile.file),
    blobs,
    hash: webCryptoHasher(),
    stamp: FIXED_STAMP,
    debounceMs: 0,
  });
}

async function remoteText(path: string): Promise<string | null> {
  const got = await port.getFile(path);
  return got.ok ? new TextDecoder().decode(got.content) : null;
}

beforeEach(() => {
  vault = memVaultFs();
  baseFile = fakeJsonFile();
  blobs = new InMemoryBaseBlobStore();
  port = new InMemorySyncPort(VAULT_ID);
});

describe("SyncEngine over the RN adapters", () => {
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
    expect(await remoteText("a.md")).toBe("AAA");
    expect(await remoteText("notes/b.md")).toBe("BBB");
  });

  it("pulls a coordinator-only file into the local vault", async () => {
    await port.putFile("remote-only.md", new TextEncoder().encode("REMOTE"), 0);

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

  it("is a no-op once both sides have converged (a second engine reads the persisted base)", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce();
    const putSpy = vi.spyOn(port, "putFile");
    const deleteSpy = vi.spyOn(port, "deleteFile");

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
    // No coordinator writes.
    expect(putSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("mirrors a local delete to the coordinator", async () => {
    // A sibling survives the delete: an empty local listing against a
    // non-empty base is refused by the engine's empty-listing guard.
    vault.writeText("gone.md", "bye");
    vault.writeText("stays.md", "here");
    await newEngine().syncOnce();
    expect(await remoteText("gone.md")).toBe("bye");

    vault.files.delete("gone.md");
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

  // A missing vault root makes the `VaultFs` THROW
  // (expo-vault-fs's listDir("") contract) rather than list an empty vault —
  // the pass fails cleanly instead of reconciling "everything was deleted".
  it("a root-missing vault fails the pass — zero deletes reach the coordinator", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");
    await newEngine().syncOnce();
    const baseBefore = baseFile.peek();

    const rootMissing: VaultFs = {
      ...vault.fs,
      listDir: (relDir) => {
        if (relDir === "") throw new VaultRootMissingError();
        return vault.fs.listDir(relDir);
      },
    };
    const deleteSpy = vi.spyOn(port, "deleteFile");
    const putSpy = vi.spyOn(port, "putFile");

    const out = await newEngine(rootMissing).syncOnce();

    expect(out).toMatchObject({
      status: "error",
      message: expect.stringContaining("vault root"),
    });
    // The truncated listing never reached reconcile: zero ops, remote intact,
    // base anchor byte-identical for the next pass to retry from.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
    expect(await remoteText("a.md")).toBe("AAA");
    expect(await remoteText("notes/b.md")).toBe("BBB");
    expect(baseFile.peek()).toBe(baseBefore);
  });

  it("resolves a both-sides edit: winner keeps the path, loser becomes a conflict copy", async () => {
    vault.writeText("note.md", "base");
    await newEngine().syncOnce();

    // A peer advances the coordinator copy; we edit the same file locally.
    await port.putFile("note.md", new TextEncoder().encode("remote-wins"), 1);
    vault.writeText("note.md", "local-loser");

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.conflicts).toBe(1);
    expect(vault.readText("note.md")).toBe("remote-wins");
    // The losing local bytes survive beside it as a conflict copy on both sides.
    const copyPath = conflictCopyName("note.md", FIXED_STAMP());
    expect(vault.readText(copyPath)).toBe("local-loser");
    expect(await remoteText(copyPath)).toBe("local-loser");
  });

  it("with a blob store wired, a both-appended journal merges instead of forking", async () => {
    // The RN composition arms the ladder exactly like the desktop's (the
    // platform-neutral InMemory store here; expo-blob-store.ts on device —
    // core's engine-merge.test.ts owns the full merge matrix).
    const blobs = new InMemoryBaseBlobStore();
    const engineWithBlobs = () =>
      new SyncEngine({
        vaultId: VAULT_ID,
        port,
        io: createSyncIo(vault.fs),
        base: createJsonFileBaseStore(baseFile.file),
        blobs,
        hash: webCryptoHasher(),
        stamp: FIXED_STAMP,
        debounceMs: 0,
      });

    vault.writeText("journal.md", "day\n");
    await engineWithBlobs().syncOnce();
    await port.putFile("journal.md", new TextEncoder().encode("day\n- remote\n"), 1);
    vault.writeText("journal.md", "day\n- local\n");

    const out = await engineWithBlobs().syncOnce();

    expect(out).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 0,
      deleted: 0,
      conflicts: 0,
      merged: 1,
      conflictPaths: [],
    });
    expect(vault.readText("journal.md")).toBe("day\n- remote\n- local\n");
    expect(await remoteText("journal.md")).toBe("day\n- remote\n- local\n");
  });
});

// The mobile SyncIo feeds the engine's stat-keyed hash cache — an unchanged
// fingerprint reuses the cached hash instead of re-reading + re-hashing
// the whole vault every pass. These drive the REAL mobile adapter (createSyncIo
// over a VaultFs) against the engine; the engine-side cache matrix lives in
// @repo/notes's engine-hash-cache.test.ts.
describe("stat-fingerprint hash cache over the RN adapters", () => {
  /** An engine over `fs` with a hasher that records every (decoded) input, so
   * tests count exactly which files were re-hashed. Cache is per-instance —
   * reuse tests must run both passes on the SAME engine (as manager.ts does:
   * one engine lives as long as its token). */
  function countingEngine(fs: VaultFs = vault.fs): { engine: SyncEngine; calls: string[] } {
    const inner = webCryptoHasher();
    const calls: string[] = [];
    const engine = new SyncEngine({
      vaultId: VAULT_ID,
      port,
      io: createSyncIo(fs),
      base: createJsonFileBaseStore(baseFile.file),
      blobs,
      hash: (bytes) => {
        calls.push(new TextDecoder().decode(bytes));
        return inner(bytes);
      },
      stamp: FIXED_STAMP,
      debounceMs: 0,
    });
    return { engine, calls };
  }

  it("reuses an unchanged file's hash across passes — hasher runs once, not twice", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");
    const { engine, calls } = countingEngine();

    await engine.syncOnce();
    expect(calls).toEqual(["AAA", "BBB"]); // first pass hashes everything once

    const before = calls.length;
    await engine.syncOnce();
    expect(calls.length).toBe(before); // unchanged fingerprints — zero re-hashes
  });

  it("re-hashes a file whose fingerprint moved — even a same-length edit", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("b.md", "BBB");
    const { engine, calls } = countingEngine();
    await engine.syncOnce();

    const before = calls.length;
    vault.writeText("a.md", "AAB"); // same size — only the fake mtime moves
    await engine.syncOnce();

    expect(calls.slice(before)).toEqual(["AAB"]); // a.md re-hashed, b.md reused
  });

  it("a stat failure yields a null fingerprint — safe re-hash every pass", async () => {
    vault.writeText("a.md", "AAA");
    const statless: VaultFs = {
      ...vault.fs,
      stat: () => {
        throw new Error("stat failed");
      },
    };
    const { engine, calls } = countingEngine(statless);

    await engine.syncOnce();
    expect(calls).toEqual(["AAA"]);
    await engine.syncOnce();
    expect(calls).toEqual(["AAA", "AAA"]); // null fingerprint → never cached
  });
});
