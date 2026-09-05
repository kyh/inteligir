// The store is a cache: recovery from corruption or a version mismatch is
// delete-and-rebuild from the vault, so nothing durable may live in it.
// Synchronous because the sqlite binding behind it is; the host chunks batches.

import type { SearchResult } from "./knowledge-index";
import type { DocProjection } from "./projection";
import type { SearchHit } from "./search-index";
import type { DocText } from "./text-matches";

export type StoredDocRow = {
  path: string;
  contentHash: string;
  projection: DocProjection;
};

export type KnowledgeStore = {
  loadAll(): { docs: StoredDocRow[]; others: { path: string }[] };

  upsertDoc(row: StoredDocRow, body: string): void;

  upsertOther(path: string): void;

  remove(path: string): void;

  clear(): void;

  search(query: string, limit: number): SearchResult[];

  /** paths and scores only — the related-notes probe shows no row, so no excerpt is cut. */
  searchRanked(query: string, limit: number): SearchHit[];

  /**
   * every doc's text for the literal scan, in path order; `prefilter` (text-matches'
   * bodyPrefilter) lets the store drop docs that cannot hold the needle, case-insensitively
   * over ascii, and null asks for all of them.
   */
  docTexts(prefilter: string | null): DocText[];

  transaction(fn: () => void): void;

  nuke(): void;

  dispose(): void;
};
