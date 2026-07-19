import { beforeEach, describe, expect, it } from "vitest";

import { InMemorySyncPort } from "./in-memory-sync-port";
import { SyncEngine, type Clock, type Hasher, type SyncIo } from "../engine";
import { InMemoryBaseStore } from "../base-store";
import { InMemoryBaseBlobStore } from "../blob-store";
import { conflictCopyName, isConflictCopyPath } from "../reconcile";
import type { PutResult, SyncPort } from "../sync-port";
import type { VaultPath } from "../vault-file";

// Engine-level merge-ladder tests: the same in-memory rig as engine.test.ts
// PLUS an `InMemoryBaseBlobStore`, so both-sides-changed markdown reaches the
// ladder with true base bytes. engine.test.ts pins the no-blobs behavior.

const VAULT_ID = "vault-1";
const STAMP = "2026-07-05T12-34-56-000Z";

const enc = new TextEncoder();
const dec = new TextDecoder();

function webCryptoHasher(): Hasher {
  return async (bytes) => {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
}

const fixedStamp: Clock = () => STAMP;

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

  paths(): string[] {
    return [...this.files.keys()].toSorted();
  }
}

function encode(text: string): Uint8Array {
  return enc.encode(text);
}

let vault: MemoryVault;
let base: InMemoryBaseStore;
let port: InMemorySyncPort;
let blobs: InMemoryBaseBlobStore;

function newEngine(): SyncEngine {
  return new SyncEngine({
    vaultId: VAULT_ID,
    port,
    io: vault.io,
    base,
    blobs,
    hash: webCryptoHasher(),
    stamp: fixedStamp,
    debounceMs: 0,
  });
}

async function remoteText(p: string): Promise<string | null> {
  const got = await port.getFile(p);
  return got.ok ? dec.decode(got.content) : null;
}

async function sha256Hex(text: string): Promise<string> {
  return webCryptoHasher()(enc.encode(text));
}

beforeEach(() => {
  vault = new MemoryVault();
  base = new InMemoryBaseStore();
  port = new InMemorySyncPort(VAULT_ID);
  blobs = new InMemoryBaseBlobStore();
});

describe("SyncEngine + merge ladder", () => {
  it("merges a both-appended .md (push + local write), advances base, GCs the old blob", async () => {
    // Shared base at v1.
    vault.writeText("journal.md", "day\n");
    await newEngine().syncOnce();
    const baseHash = await sha256Hex("day\n");
    expect(blobs.get(baseHash)).not.toBeNull(); // captured on push

    // Peer appends (v2); we append differently off the stale base.
    await port.putFile("journal.md", encode("day\n- remote\n"), 1);
    vault.writeText("journal.md", "day\n- local\n");

    const out = await newEngine().syncOnce();

    expect(out).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 0,
      deleted: 0,
      conflicts: 0,
      merged: 1,
      conflictPaths: [],
    });
    // Union, remote tail first — identical on both sides, zero copies.
    expect(vault.readText("journal.md")).toBe("day\n- remote\n- local\n");
    expect(await remoteText("journal.md")).toBe("day\n- remote\n- local\n");
    expect(vault.paths().some(isConflictCopyPath)).toBe(false);

    // Base advanced: the follow-up pass is a no-op.
    const settled = await newEngine().syncOnce();
    expect(settled).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0, merged: 0 });

    // Blob GC: the superseded base blob is gone; the new base's blob is kept.
    expect(blobs.get(baseHash)).toBeNull();
    expect(blobs.get(await sha256Hex("day\n- remote\n- local\n"))).not.toBeNull();
  });

  it("whitespace-equal sides converge to the remote bytes with ZERO coordinator traffic", async () => {
    vault.writeText("note.md", "text\n");
    await newEngine().syncOnce();
    // Both sides added the same line — the local one with trailing whitespace.
    await port.putFile("note.md", encode("text\nadd\n"), 1);
    vault.writeText("note.md", "text\nadd  \n");

    const gen = port.currentGeneration();
    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "ok", merged: 1, conflicts: 0, conflictPaths: [] });
    // Converged to the REMOTE bytes locally; nothing pushed.
    expect(vault.readText("note.md")).toBe("text\nadd\n");
    expect(port.currentGeneration()).toBe(gen);
  });

  it("falls back to a conflict copy when the base blob is missing (legacy base)", async () => {
    vault.writeText("note.md", "base\n");
    await newEngine().syncOnce();
    await port.putFile("note.md", encode("base\nremote\n"), 1);
    vault.writeText("note.md", "base\nlocal\n");
    // Simulate a pre-blob-store client: the base manifest exists, its bytes don't.
    blobs.prune(new Set());

    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "ok", merged: 0, conflicts: 1 });
    expect(vault.readText("note.md")).toBe("base\nremote\n");
    expect(vault.readText(conflictCopyName("note.md", STAMP))).toBe("base\nlocal\n");
  });

  it("creation collision on a NEW .md unions without any base", async () => {
    // Peer created the file first (v1); we independently created it locally.
    await port.putFile("today.md", encode("# Today\n- theirs\n"), 0);
    vault.writeText("today.md", "# Today\n- ours\n");

    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "ok", merged: 1, conflicts: 0 });
    expect(vault.readText("today.md")).toBe("# Today\n- theirs\n- ours\n");
    expect(await remoteText("today.md")).toBe("# Today\n- theirs\n- ours\n");
  });

  it("retries a mid-merge version conflict ONCE, then downgrades to a conflict copy", async () => {
    vault.writeText("note.md", "base\n");
    await newEngine().syncOnce();
    await port.putFile("note.md", encode("base\nremote\n"), 1);
    vault.writeText("note.md", "base\nlocal\n");

    // A port whose putFile lets a peer sneak in a MERGEABLE append before every
    // attempt on note.md — so the ladder's put version-conflicts, the single
    // retry re-fetches + re-merges + puts again, conflicts AGAIN, and the
    // engine must then give up to a conflict copy (never a third attempt).
    let raced = 0;
    const racingPort: SyncPort = {
      listManifest: () => port.listManifest(),
      getFile: (path) => port.getFile(path),
      deleteFile: (path, v) => port.deleteFile(path, v),
      subscribe: (onChange) => port.subscribe(onChange),
      putFile: async (path, content, expected): Promise<PutResult> => {
        if (path === "note.md" && raced < 2) {
          raced += 1;
          const current = await port.getFile(path);
          if (current.ok) {
            const grown = `${dec.decode(current.content)}peer ${raced}\n`;
            await port.putFile(path, encode(grown), current.file.version);
          }
        }
        return port.putFile(path, content, expected);
      },
    };
    const engine = new SyncEngine({
      vaultId: VAULT_ID,
      port: racingPort,
      io: vault.io,
      base,
      blobs,
      hash: webCryptoHasher(),
      stamp: fixedStamp,
      debounceMs: 0,
    });

    const out = await engine.syncOnce();

    expect(out).toMatchObject({ status: "ok", merged: 0, conflicts: 1 });
    // Exactly two ladder put attempts raced (initial + single retry) before
    // the downgrade; the local edit survives as a copy.
    expect(raced).toBe(2);
    expect(vault.readText(conflictCopyName("note.md", STAMP))).toBe("base\nlocal\n");
  });

  it("never attempts a merge on a non-.md asset (conflict copy as always)", async () => {
    vault.writeText("data.bin", "v1\n");
    await newEngine().syncOnce();
    await port.putFile("data.bin", encode("v1\nremote\n"), 1);
    vault.writeText("data.bin", "v1\nlocal\n");

    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "ok", merged: 0, conflicts: 1 });
    expect(vault.readText("data.bin")).toBe("v1\nremote\n");
    expect(vault.readText(conflictCopyName("data.bin", STAMP))).toBe("v1\nlocal\n");
    // And no blob was ever captured for it — markdown only.
    expect(blobs.hashes().size).toBe(0);
  });

  it("a merged path is NEVER listed in conflictPaths (conflict UIs stay clean)", async () => {
    vault.writeText("journal.md", "day\n");
    await newEngine().syncOnce();
    await port.putFile("journal.md", encode("day\nremote\n"), 1);
    vault.writeText("journal.md", "day\nlocal\n");

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.merged).toBe(1);
      expect(out.conflicts).toBe(0);
      expect(out.conflictPaths).toEqual([]);
    }
  });
});
