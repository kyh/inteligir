// ---------------------------------------------------------------------------
// The agent-facing KnowledgePort — the ONE choke point where index results
// become model-visible text (search_vault / get_backlinks / get_links), plus
// the port's single mutation, rename (rename_note — same rewrite pipeline as
// user renames; see renameNote below). SECURITY-CRITICAL: a private note's
// PATH and SNIPPET are both leaks, so non-public hits are dropped ENTIRELY,
// never annotated.
//
// Two layers, both required:
//  (1) index prefilter — every query runs with { excludePrivate: true } (the
//      SQL store filters inside the WHERE, pre-limit), so private text never
//      even transits the result set;
//  (2) LIVE re-probe — the index lags a just-saved `private: true` by the
//      refresh debounce (~100ms+) — a plain TOCTOU window. Every surviving
//      hit is probed against disk and kept ONLY when it reads "public" now.
//
// Refusal shape: the port drops SILENTLY everywhere. get_backlinks on a
// private target returns [] and the tool returns an empty JSON array,
// indistinguishable from a note with none, so the response never confirms a
// guessed path exists or is private. The explicit "this note is private"
// refusal lives ONLY on the direct file-tool gate (privacy/gate.ts). That gate
// IS a per-path existence/privacy oracle for a model-GUESSED path (private →
// refusal, absent → the tool's own ENOENT) — an ACCEPTED hole, documented in
// docs/privacy.md: paths only, near-inherent to per-path gating, and already
// reachable via `bash ls`.
//
// This lives on its own, outside agent-wiring, so the guarantee is testable
// without host singletons — __tests__/knowledge-privacy.test.ts stringifies
// real tool results and asserts the private note never appears.
// ---------------------------------------------------------------------------

import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import type { BacklinkEntry, ForwardLinkEntry } from "@repo/notes/knowledge/link-graph-index";
import type { PrivacyOpts } from "@repo/notes/knowledge/link-graph-index";
import type { RelatedNoteEntry, RelatedNotesOpts } from "@repo/notes/knowledge/related-notes";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath } from "@repo/notes/knowledge/vault-path";

import { renameWithLinkRewrite } from "../knowledge/rename-rewrite";
import type { KnowledgePort, PrivacyProbe, RenameNoteResult } from "@repo/agent/extension";
import type { VaultManager } from "@repo/vault/vault";

/** The queries the port wraps — KnowledgeManager (production) and core's
 * KnowledgeIndex (tests) both satisfy it structurally. */
export type KnowledgeQueries = {
  search(query: string, limit?: number, opts?: PrivacyOpts): SearchResult[];
  backlinks(path: string, opts?: PrivacyOpts): BacklinkEntry[];
  /** NOTE the missing PrivacyOpts — unlike its siblings, forwardLinks has no
   * index-level privacy filter, because its other caller is the renderer's
   * Links panel, which is the USER looking at their own vault and must see
   * every link. The whole privacy story for this query therefore lives in the
   * port below; do not "fix" the asymmetry by teaching the index to filter
   * without also checking what the renderer would lose. */
  forwardLinks(path: string): ForwardLinkEntry[];
  relatedNotes(path: string, opts?: RelatedNotesOpts): RelatedNoteEntry[];
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
  /** One memo, scoped to ONE port call. The probe is a full file read plus a
   * realpath of the target, and a single query can name the same note many
   * times over — a hub note that links its index twenty times would otherwise
   * pay twenty identical disk round-trips inside one call. Sound because a
   * filter runs to completion synchronously: no write can interleave within a
   * call, so the memo can never answer something the un-memoized probe would
   * not have. It must NOT outlive the call — that is the whole point of the
   * live re-probe (layer 2 above). */
  const openProbe = (): {
    verdict: (rel: string) => PrivacyProbe;
    isPublic: (rel: string) => boolean;
  } => {
    const memo = new Map<string, PrivacyProbe>();
    const verdict = (rel: string): PrivacyProbe => {
      const seen = memo.get(rel);
      if (seen !== undefined) return seen;
      const fresh = deps.probe(rel);
      memo.set(rel, fresh);
      return fresh;
    };
    return { verdict, isPublic: (rel) => verdict(rel) === "public" };
  };
  return {
    search: (query, limit) => {
      const live = openProbe();
      return deps
        .queries()
        .search(query, limit, EXCLUDE)
        .filter((hit) => live.isPublic(hit.path));
    },
    backlinks: (path) => {
      const live = openProbe();
      // A private/unreadable TARGET yields [] — silently (see header).
      const target = live.verdict(path);
      if (target === "private" || target === "indeterminate") return [];
      return deps
        .queries()
        .backlinks(path, EXCLUDE)
        .filter((entry) => live.isPublic(entry.sourcePath));
    },
    forwardLinks: (path) => {
      const live = openProbe();
      // A private/unreadable SUBJECT yields [] — silently, exactly like
      // backlinks (see header).
      const subject = live.verdict(path);
      if (subject === "private" || subject === "indeterminate") return [];
      // Layer (1) does not exist for this query — forwardLinks takes no
      // PrivacyOpts (see KnowledgeQueries) — so the live probe below is the
      // ONLY privacy layer here. It must stay.
      //
      // What the tool adds over reading the note is RESOLUTION: the raw
      // `[[Secret Plans]]` text sits in the subject's own body either way, but
      // WHICH FILE it lands on is index knowledge, and a private note's path
      // is a leak. So a resolved target that isn't public right now is dropped
      // entirely rather than annotated, per the header's rule.
      //
      // A DANGLING entry (targetPath null) passes through untouched: no file
      // stands behind it, so there is nothing to be private, and the tool
      // renders it as explicitly unresolved. "absent" fails the public check
      // too, so a target deleted since the last index pass drops exactly the
      // way a private one does — that ambiguity is what keeps the omission
      // from being a privacy oracle.
      return deps
        .queries()
        .forwardLinks(path)
        .filter((entry) => entry.targetPath === null || live.isPublic(entry.targetPath));
    },
    relatedNotes: (path) => {
      const live = openProbe();
      // A private/unreadable SUBJECT yields [] — silently, exactly like
      // backlinks (see header): "no related notes" never confirms a path.
      const target = live.verdict(path);
      if (target === "private" || target === "indeterminate") return [];
      return deps
        .queries()
        .relatedNotes(path, EXCLUDE)
        .filter((entry) => live.isPublic(entry.path));
    },
    notesWithTag: (tag) => {
      const live = openProbe();
      return deps
        .queries()
        .notesWithTag(tag, EXCLUDE)
        .filter((path) => live.isPublic(path));
    },
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
