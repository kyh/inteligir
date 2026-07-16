import { beforeEach, describe, expect, it } from "vitest";

import { InMemorySyncPort } from "./in-memory-sync-port";
import { SyncEngine, type Clock, type Hasher, type SyncIo } from "../engine";
import { InMemoryBaseStore } from "../base-store";
import type { VaultPath } from "../vault-file";

// Verifies the stat-keyed hash cache: a pass reuses a file's hash when its
// fingerprint is unchanged, re-hashes when it changes or is unavailable, and
// falls back to full re-hashing when a platform omits `fingerprint` entirely.

const VAULT_ID = "vault-1";
const STAMP = "2026-07-05T12-34-56-000Z";

const enc = new TextEncoder();
const dec = new TextDecoder();

// Web Crypto keeps @repo/core node-free even in tests and matches the port fake.
function webCryptoHasher(): Hasher {
  return async (bytes) => {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
}

/** A hasher that records the (decoded) text of every input it hashes, so tests
 * can count calls and see WHICH files were re-hashed. */
function countingHasher(): { hash: Hasher; calls: string[] } {
  const inner = webCryptoHasher();
  const calls: string[] = [];
  const hash: Hasher = (bytes) => {
    calls.push(dec.decode(bytes));
    return inner(bytes);
  };
  return { hash, calls };
}

const fixedStamp: Clock = () => STAMP;

/** A Map-backed vault with a controllable stat fingerprint. A monotonic token
 * bumps on every mutation, mirroring how a real mtime/size/ino key moves when
 * content can have changed. */
class FingerprintVault {
  private readonly files = new Map<VaultPath, Uint8Array>();
  private readonly fps = new Map<VaultPath, string>();
  private readonly noFp = new Set<VaultPath>();
  private counter = 0;
  /** When true, the engine's own `io.write` does NOT bump the fingerprint —
   * an adversarial setup that isolates the engine's write-invalidation from
   * fingerprint change-detection. */
  stickyOnWrite = false;

  readonly io: SyncIo = {
    list: () => [...this.files.keys()].toSorted(),
    read: (path) => {
      const bytes = this.files.get(path);
      if (bytes === undefined) throw new Error(`FingerprintVault: read of absent ${path}`);
      return bytes;
    },
    write: (path, content) => {
      this.files.set(path, new Uint8Array(content));
      if (!this.stickyOnWrite) this.bump(path);
    },
    remove: (path) => {
      this.files.delete(path);
      this.fps.delete(path);
    },
    fingerprint: (path) => (this.noFp.has(path) ? null : (this.fps.get(path) ?? null)),
  };

  private bump(path: VaultPath): void {
    this.counter += 1;
    this.fps.set(path, `fp-${this.counter}`);
  }

  /** External (user/agent) edit — always moves the fingerprint. */
  writeText(path: string, text: string): void {
    this.files.set(path, enc.encode(text));
    this.bump(path);
  }

  readText(path: string): string | null {
    const bytes = this.files.get(path);
    return bytes === undefined ? null : dec.decode(bytes);
  }

  /** Make `fingerprint(path)` return null (platform can't stat this file). */
  markNoFingerprint(path: string): void {
    this.noFp.add(path);
  }
}

/** A plain Map-backed vault WITHOUT a fingerprint — the mobile fallback. */
class NoFingerprintVault {
  private readonly files = new Map<VaultPath, Uint8Array>();

  readonly io: SyncIo = {
    list: () => [...this.files.keys()].toSorted(),
    read: (path) => {
      const bytes = this.files.get(path);
      if (bytes === undefined) throw new Error(`NoFingerprintVault: read of absent ${path}`);
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
}

let base: InMemoryBaseStore;
let port: InMemorySyncPort;

function newEngine(io: SyncIo, hash: Hasher): SyncEngine {
  return new SyncEngine({
    vaultId: VAULT_ID,
    port,
    io,
    base,
    hash,
    stamp: fixedStamp,
    debounceMs: 0,
  });
}

function encode(text: string): Uint8Array {
  return enc.encode(text);
}

beforeEach(() => {
  base = new InMemoryBaseStore();
  port = new InMemorySyncPort(VAULT_ID);
});

describe("SyncEngine stat-keyed hash cache", () => {
  it("re-hashes nothing on a second pass when no fingerprints changed", async () => {
    const vault = new FingerprintVault();
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");
    const { hash, calls } = countingHasher();
    const engine = newEngine(vault.io, hash);

    await engine.syncOnce();
    const afterFirst = calls.length;
    expect(afterFirst).toBe(2); // both files hashed once on the first pass

    await engine.syncOnce();
    expect(calls.length - afterFirst).toBe(0); // second pass reuses cached hashes
  });

  it("re-hashes exactly the file whose fingerprint changed", async () => {
    const vault = new FingerprintVault();
    vault.writeText("a.md", "AAA");
    vault.writeText("b.md", "BBB");
    const { hash, calls } = countingHasher();
    const engine = newEngine(vault.io, hash);

    await engine.syncOnce();
    const before = calls.length;

    vault.writeText("a.md", "AAA-edited"); // bumps a.md's fingerprint only
    await engine.syncOnce();

    const rehashed = calls.slice(before);
    expect(rehashed).toEqual(["AAA-edited"]); // only a.md re-hashed, b.md reused
  });

  it("re-hashes a file whose fingerprint is unavailable every pass", async () => {
    const vault = new FingerprintVault();
    vault.writeText("a.md", "AAA");
    vault.markNoFingerprint("a.md");
    const { hash, calls } = countingHasher();
    const engine = newEngine(vault.io, hash);

    await engine.syncOnce();
    const afterFirst = calls.length;
    expect(afterFirst).toBe(1);

    await engine.syncOnce(); // no fingerprint → cannot cache → re-hash
    expect(calls.slice(afterFirst)).toEqual(["AAA"]);
  });

  it("re-hashes every file each pass when the adapter omits fingerprint (mobile pin)", async () => {
    const vault = new NoFingerprintVault();
    vault.writeText("a.md", "AAA");
    vault.writeText("b.md", "BBB");
    const { hash, calls } = countingHasher();
    const engine = newEngine(vault.io, hash);

    await engine.syncOnce();
    expect(calls.length).toBe(2); // file count

    const before = calls.length;
    await engine.syncOnce();
    expect(calls.length - before).toBe(2); // full re-hash again — no cache
  });

  it("hashes the pulled content after an engine write (invalidation), even with a sticky fingerprint", async () => {
    // Converge local + remote on a shared file.
    const vault = new FingerprintVault();
    vault.writeText("note.md", "shared");
    const { hash, calls } = countingHasher();
    const engine = newEngine(vault.io, hash);
    await engine.syncOnce();

    // A peer advances the coordinator's copy. Local is unchanged (its cached
    // hash stays valid), so the next pass must PULL.
    const seen = (await port.listManifest()).files.find((f) => f.path === "note.md")?.version;
    expect(seen).toBe(1);
    const bumped = await port.putFile("note.md", encode("remote-new"), 1);
    expect(bumped.ok).toBe(true);

    // Adversarial: the engine's own io.write will NOT move the fingerprint, so
    // the ONLY thing that can prevent a stale cached hash is the engine's
    // explicit invalidation on write.
    vault.stickyOnWrite = true;

    const pull = await engine.syncOnce();
    expect(pull).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 1,
      deleted: 0,
      conflicts: 0,
      merged: 0,
      conflictPaths: [],
    });
    expect(vault.readText("note.md")).toBe("remote-new");

    // The follow-up pass must see the file as converged (its manifest carries
    // the NEW content's hash). If invalidation were broken, the cache would
    // still hold hash("shared") under the unchanged fingerprint and this pass
    // would spuriously re-push the stale bytes, bumping the generation.
    const genBefore = port.currentGeneration();
    const settled = await engine.syncOnce();
    expect(settled).toEqual({
      status: "ok",
      pushed: 0,
      pulled: 0,
      deleted: 0,
      conflicts: 0,
      merged: 0,
      conflictPaths: [],
    });
    expect(port.currentGeneration()).toBe(genBefore);
    expect(calls).toContain("remote-new"); // the pulled bytes were hashed
  });
});
