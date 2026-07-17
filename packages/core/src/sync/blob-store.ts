import type { Hash } from "./vault-file";

// ---------------------------------------------------------------------------
// BaseBlobStore — a LOCAL content-addressed shadow of the last-synced BASE
// bytes, keyed by the sha-256 contentHash the base manifest already records.
// Neither the coordinator (current manifest row + in-place R2 bytes only) nor
// the base manifest (hashes only) keeps historical bytes, so this store is
// what gives the merge ladder a TRUE 3-way base: the engine captures bytes at
// every moment it already holds bytes+hash (pull, push success, conflict-copy
// push, the manifest build's read+hash path) — atomic with base advancement —
// and prunes to the new base's markdown hashes after every `saveBase`.
//
// Injected into `SyncEngine` like `BaseStore`, so one engine serves a node
// flat-dir store (desktop) and an Expo File store (mobile) alike. The store is
// a pure CACHE: a missing blob only downgrades a merge to today's
// conflict-copy behavior, never loses data.
// ---------------------------------------------------------------------------

/** Whether `name` is a content-addressed blob file name (sha-256 hex). Only
 * such entries are the store's own — platform prune() implementations must
 * never touch a foreign file. */
export function isBlobFileName(name: string): boolean {
  return /^[0-9a-f]{64}$/.test(name);
}

export interface BaseBlobStore {
  /** The bytes stored under `hash`, or `null` when missing or integrity-suspect
   * (an implementation that can cheaply re-hash must return `null` on a
   * mismatch rather than hand back corrupt base bytes). */
  get(hash: Hash): Uint8Array | null;
  /** Store `bytes` under `hash`. PORT CONTRACT: an existence-checked no-op when
   * `hash` is already stored — mobile has no stat fingerprint, so the manifest
   * build re-reads every file every pass and calls `put` for each; a naive
   * implementation would rewrite every blob every five minutes. Must not throw:
   * capture is best-effort (a dropped blob degrades to a conflict copy). */
  put(hash: Hash, bytes: Uint8Array): void;
  /** Drop every stored blob whose hash is not in `keep` (the new base's
   * markdown hashes). Must not throw; a failed deletion is retried next pass. */
  prune(keep: ReadonlySet<Hash>): void;
}

/** A Map-backed `BaseBlobStore` — the reference implementation + test double. */
export class InMemoryBaseBlobStore implements BaseBlobStore {
  private readonly blobs = new Map<Hash, Uint8Array>();

  get(hash: Hash): Uint8Array | null {
    return this.blobs.get(hash) ?? null;
  }

  put(hash: Hash, bytes: Uint8Array): void {
    if (this.blobs.has(hash)) return;
    this.blobs.set(hash, new Uint8Array(bytes));
  }

  prune(keep: ReadonlySet<Hash>): void {
    for (const hash of this.blobs.keys()) {
      if (!keep.has(hash)) this.blobs.delete(hash);
    }
  }

  /** Stored hashes (test assertions — GC checks). */
  hashes(): ReadonlySet<Hash> {
    return new Set(this.blobs.keys());
  }
}
