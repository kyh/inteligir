// ---------------------------------------------------------------------------
// KnowledgeStore — the persistence port for projected vault knowledge. TYPES
// ONLY, because this package carries no SQLite dependency: platforms bind an
// implementation (the host: the Durable Object's own SQLite; the fixture
// bridge: SQLite wasm) and the shell around it drives the store, mirroring
// every write into the in-memory LinkGraphIndex.
//
// THE STORE IS A CACHE. Nothing durable may ever live in it: recovery from any
// corruption/version mismatch is delete-and-rebuild from the vault, which is
// only safe while that invariant holds. Durable state belongs in the platform
// state stores (the manifest, the host's JsonStores), never here.
//
// All methods are synchronous — SQLite bindings on every target platform are
// synchronous, and the host shell owns chunking/yielding around batches.
// ---------------------------------------------------------------------------

import type { SearchResult } from "./knowledge-index";
import type { PrivacyOpts } from "./link-graph-index";
import type { DocProjection } from "./projection";

/** Stat identity of an indexed file — the incremental-refresh diff basis.
 * `ino` rides along because atomic writes (temp + rename) always land on a
 * fresh inode, so even an exact (mtime, size) collision can't masquerade as
 * "unchanged". */
export type StoredFingerprint = {
  mtimeMs: number;
  size: number;
  ino: number;
};

/** One indexed doc as persisted: identity, change-detection keys, projection. */
export type StoredDocRow = {
  path: string;
  fingerprint: StoredFingerprint;
  /** sha-256 hex of the doc text — the write authority ABOVE the fingerprint:
   * a provider-wide mtime rewrite re-reads but never re-projects/re-writes. */
  contentHash: string;
  projection: DocProjection;
};

export type KnowledgeStore = {
  /** Everything persisted, for boot hydration: one read, zero parses. */
  loadAll(): { docs: StoredDocRow[]; others: { path: string }[] };

  /** Insert or replace a doc's row, child records, and search corpus entry.
   * `body` is the doc's full text — the store owns the search corpus so no
   * in-memory index has to retain bodies. */
  upsertDoc(row: StoredDocRow, body: string): void;

  /** Register a non-doc vault file (image, pdf, …). */
  upsertOther(path: string): void;

  /** Persist a fingerprint alone — the hash-equal fast path (an mtime rewrite
   * with unchanged content), so the next boot's stat diff stays quiet without
   * re-projecting or churning the search corpus. */
  updateFingerprint(path: string, fingerprint: StoredFingerprint): void;

  /** Drop a file (doc or other) and all its child records. */
  remove(path: string): void;

  /** Empty every table (kept schema) — a root re-index in place. */
  clear(): void;

  /** Ranked full-text search over the stored corpus. `excludePrivate` filters
   * `private: true` docs INSIDE the query (WHERE, before the limit) — the
   * agent-facing prefilter; renderer callers omit it and see everything. */
  search(query: string, limit: number, opts?: PrivacyOpts): SearchResult[];

  /** Run `fn` atomically — the host batches reconcile writes through this. */
  transaction(fn: () => void): void;

  /** Destroy the store's persisted state entirely and reinitialize empty —
   * the corruption escape hatch. Always safe: the store is a cache. */
  nuke(): void;

  dispose(): void;
};
