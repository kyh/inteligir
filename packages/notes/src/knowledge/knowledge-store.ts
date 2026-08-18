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
import type { DocProjection } from "./projection";
import type { SearchHit } from "./search-index";

/** One indexed doc as persisted: identity, change-detection key, projection. */
export type StoredDocRow = {
  path: string;
  /** sha-256 hex of the doc text — the whole change-detection basis. The
   * manifest already computes it, so reconcile diffs hashes and never stats:
   * there is no filesystem behind this store to stat. */
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

  /** Drop a file (doc or other) and all its child records. */
  remove(path: string): void;

  /** Empty every table (kept schema) — a root re-index in place. */
  clear(): void;

  /** Ranked full-text search over the stored corpus. */
  search(query: string, limit: number): SearchResult[];

  /** The same ranking, paths and scores ONLY — no body read, no excerpt cut.
   * What the related-notes lexical probe asks for: it blends scores and shows
   * no row, so the excerpt is work with no reader. Answers {@link SearchHit},
   * which is also what the pure SearchIndex's own ranked read returns, so both
   * engines satisfy `relatedNotes`' lexical port with the same type. */
  searchRanked(query: string, limit: number): SearchHit[];

  /** Run `fn` atomically — the host batches reconcile writes through this. */
  transaction(fn: () => void): void;

  /** Destroy the store's persisted state entirely and reinitialize empty —
   * the corruption escape hatch. Always safe: the store is a cache. */
  nuke(): void;

  dispose(): void;
};
