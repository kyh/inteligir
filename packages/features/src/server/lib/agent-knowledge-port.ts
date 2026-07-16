// ---------------------------------------------------------------------------
// The agent-facing KnowledgePort — the ONE choke point where index results
// become model-visible text (search_vault / get_backlinks). SECURITY-CRITICAL:
// a private note's PATH and SNIPPET are both leaks, so non-public hits are
// dropped ENTIRELY, never annotated.
//
// Two layers, both required:
//  (1) index prefilter — every query runs with { excludePrivate: true } (the
//      SQL store filters inside the WHERE, pre-limit), so private text never
//      even transits the result set;
//  (2) LIVE re-probe — the index lags a just-saved `private: true` by the
//      refresh debounce (~100ms+), reflect's TOCTOU exactly. Every surviving
//      hit is probed against disk and kept ONLY when it reads "public" now.
//
// Refusal shape (the challenge's backlinks contradiction, resolved): the port
// drops SILENTLY everywhere — get_backlinks on a private target returns [] and
// the tool says "No backlinks.", indistinguishable from a note with none, so
// the response never confirms a guessed path exists or is private. The
// explicit "this note is private" refusal lives ONLY on the direct file-tool
// gate (privacy/gate.ts), where the model already holds the path.
//
// Extracted from agent-lifecycle so the guarantee is testable without host
// singletons — __tests__/knowledge-privacy.test.ts stringifies real tool
// results and asserts the private note never appears.
// ---------------------------------------------------------------------------

import type { BacklinkEntry, SearchResult } from "@repo/core/knowledge/knowledge-index";
import type { PrivacyOpts } from "@repo/core/knowledge/link-graph-index";

import type { KnowledgePort, PrivacyProbe } from "../agent/extension";

/** The queries the port wraps — KnowledgeManager (production) and core's
 * KnowledgeIndex (tests) both satisfy it structurally. */
export type KnowledgeQueries = {
  search(query: string, limit?: number, opts?: PrivacyOpts): SearchResult[];
  backlinks(path: string, opts?: PrivacyOpts): BacklinkEntry[];
  notesWithTag(tag: string, opts?: PrivacyOpts): string[];
};

const EXCLUDE: PrivacyOpts = { excludePrivate: true };

export function buildAgentKnowledgePort(deps: {
  queries: () => KnowledgeQueries;
  /** LIVE disk probe (agent-lifecycle's vault-backed one). Only "public"
   * passes — absent/indeterminate/private all drop, fail-closed. */
  probe: (rel: string) => PrivacyProbe;
}): KnowledgePort {
  const isPublicNow = (rel: string): boolean => deps.probe(rel) === "public";
  return {
    search: (query, limit) =>
      deps
        .queries()
        .search(query, limit, EXCLUDE)
        .filter((hit) => isPublicNow(hit.path)),
    backlinks: (path) => {
      // A private/unreadable TARGET yields [] — silently (see header).
      const target = deps.probe(path);
      if (target === "private" || target === "indeterminate") return [];
      return deps
        .queries()
        .backlinks(path, EXCLUDE)
        .filter((entry) => isPublicNow(entry.sourcePath));
    },
    notesWithTag: (tag) => deps.queries().notesWithTag(tag, EXCLUDE).filter(isPublicNow),
  };
}
