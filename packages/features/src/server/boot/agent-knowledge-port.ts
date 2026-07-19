// ---------------------------------------------------------------------------
// The agent-facing KnowledgePort — the ONE choke point where index results
// become model-visible text (search_vault / get_backlinks), plus the port's
// single mutation, rename (rename_note — same rewrite pipeline as user
// renames; see renameNote below). SECURITY-CRITICAL: a private note's PATH
// and SNIPPET are both leaks, so non-public hits are dropped ENTIRELY, never
// annotated.
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
// gate (privacy/gate.ts). That gate IS a per-path existence/privacy oracle for
// a model-GUESSED path (private → refusal, absent → the tool's own ENOENT) —
// an ACCEPTED hole, documented in docs/privacy.md: paths only, near-inherent
// to per-path gating, and already reachable via `bash ls`.
//
// Extracted from agent-wiring so the guarantee is testable without host
// singletons — __tests__/knowledge-privacy.test.ts stringifies real tool
// results and asserts the private note never appears.
// ---------------------------------------------------------------------------

import type { SearchResult } from "@repo/core/knowledge/knowledge-index";
import type { BacklinkEntry } from "@repo/core/knowledge/link-graph-index";
import type { PrivacyOpts } from "@repo/core/knowledge/link-graph-index";
import { checkNoteName, noteNameErrorMessage } from "@repo/core/knowledge/note-name";
import { basenamePath } from "@repo/core/knowledge/vault-path";

import { renameWithLinkRewrite } from "../knowledge/rename-rewrite";
import type { KnowledgePort, PrivacyProbe, RenameNoteResult } from "../agent/extension";
import type { VaultManager } from "../vault/vault";

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
  /** LIVE disk probe (agent-wiring's vault-backed one). Only "public"
   * passes — absent/indeterminate/private all drop, fail-closed. */
  probe: (rel: string) => PrivacyProbe;
  /** Live VaultManager accessor (defer-to-singleton, like `queries`) — the
   * rename capability writes through it. */
  vault: () => VaultManager;
  /** Best-effort metadata remap run after a successful rename (delegations +
   * AI-write checkpoints repointed at the new path) — the SAME remap the
   * user-facing rename handler uses, injected so the two paths can't drift. */
  afterRename: (from: string, to: string) => void;
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
    rename: (from, to) => renameNote(deps, from, to),
  };
}

/** The agent's rename — the SAME pipeline as the renameVaultEntry handler
 * (handlers/vault-handlers.ts): the note-name gate on the destination
 * BASENAME only (directory moves pass through), then renameWithLinkRewrite's
 * snapshot-verified link surgery + old-title alias recording. On top, the
 * port's usual live-disk privacy re-probe on the SOURCE: the tool gate
 * already blocks rename_note args naming an INDEXED private note (gate.ts's
 * unknown-tool arg screen), and this probe closes its index-lag window with
 * the same refusal wording family the file tools use. Refusals are values,
 * never throws. */
function renameNote(
  deps: {
    probe: (rel: string) => PrivacyProbe;
    vault: () => VaultManager;
    afterRename: (from: string, to: string) => void;
  },
  from: string,
  to: string,
): RenameNoteResult {
  const verdict = checkNoteName(basenamePath(to));
  if (!verdict.ok) return { ok: false, reason: noteNameErrorMessage(verdict.reason) };
  // "absent" passes through — vault.rename's own "Not found" is the honest
  // reply; "private"/"indeterminate" refuse, fail-closed (path only, no
  // content, matching the gate's outbound-payload rule).
  const probe = deps.probe(from);
  if (probe === "private") {
    return {
      ok: false,
      reason:
        `./vault/${from} is marked private (frontmatter \`private: true\`) and cannot be ` +
        `renamed by AI tools. Tell the user the note is private.`,
    };
  }
  if (probe === "indeterminate") {
    return {
      ok: false,
      reason:
        `./vault/${from} has unreadable frontmatter and is treated as private (fail-closed), ` +
        `so it cannot be renamed. Tell the user the note could not be read.`,
    };
  }
  const result = renameWithLinkRewrite(deps.vault(), from, to);
  if (!result.ok) return { ok: false, reason: result.error };
  // Parity with the user-facing rename: repoint delegations + checkpoints.
  deps.afterRename(from, to);
  return { ok: true, from, to, linksRewritten: result.docsRewritten };
}
