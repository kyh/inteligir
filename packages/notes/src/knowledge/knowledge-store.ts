// The store is a cache: recovery from corruption or a version mismatch is
// delete-and-rebuild from the vault, so nothing durable may live in it.
// Synchronous because the sqlite binding behind it is; the host chunks batches, and hands
// upsertDoc a doc already projected and stemmed so a write parses nothing.

import type { DocProjection } from "./projection";
import type { DocSearchColumns } from "./search-columns";
import type { SearchHit } from "./search-index";
import type { SearchQueryOptions, SearchResult } from "./search-query";
import type { DocText } from "./text-matches";

// what the listing said of a doc's file when its bytes were read: a reconcile that lists the same
// pair skips the read
export interface DocFingerprint {
  size: number;
  mtimeMs: number;
}

export interface StoredDocRow {
  path: string;
  contentHash: string;
  projection: DocProjection;
  // null: the file's stat was not known when it was read, so the next reconcile reads it
  fingerprint: DocFingerprint | null;
}

export interface KnowledgeStore {
  upsertDoc: (row: StoredDocRow, search: DocSearchColumns) => void;

  /** `unprojectableHash`: the bytes of a doc whose projection threw, which stays an other */
  upsertOther: (path: string, unprojectableHash?: string) => void;

  remove: (path: string) => void;

  /** a doc read again whose bytes had not moved: only the stat its row is skipped by changes */
  setFingerprint: (path: string, fingerprint: DocFingerprint) => void;

  search: (query: string, limit: number) => SearchResult[];

  /** paths and scores only — the related-notes probe shows no row, so no excerpt is cut. */
  searchRanked: (query: string, limit: number, options?: SearchQueryOptions) => SearchHit[];

  /**
   * every doc's text for the literal scan, in path order; `prefilters` (text-matches'
   * bodyPrefilters) lets the store drop docs that hold none of them, case-insensitively over
   * ascii, and null asks for all of them.
   */
  docTexts: (prefilters: readonly string[] | null) => DocText[];

  transaction: (fn: () => void) => void;

  nuke: () => void;

  dispose: () => void;
}
