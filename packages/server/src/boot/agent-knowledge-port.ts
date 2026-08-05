// ---------------------------------------------------------------------------
// The agent-facing projections — the ONE choke point where host state becomes
// model-visible text. Two ports live here: the KnowledgePort (search_vault /
// get_backlinks / get_links / related_notes) plus its single mutation, rename
// (rename_note — same rewrite pipeline as user renames; see renameNote below),
// and the AgentVaultPort, which projects the WHOLE-VAULT and host-state reads
// (listing, tasks, tags, wiki targets, link graph, sync state, delegations).
//
// The two exist for the same reason: the handlers those reads serve are
// privacy-BLIND on purpose — the user looking at their own vault must see
// everything — so a tool generated from a window handler reads every
// `private: true` note silently, with nothing in the interface to notice.
// SECURITY-CRITICAL: a private note's PATH and SNIPPET are both leaks, so
// non-public rows are dropped ENTIRELY, never annotated.
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
//
// COST is part of the contract here. Layer (2) is a full file read per path, so
// a projection over a whole-vault read is O(vault) disk reads unless the probed
// WINDOW is bounded first. Three of them are: `listVault`, `listVaultTasks` and
// `listWikiTargets` each take a hard limit, so the probed window is one page
// rather than the vault.
// Two are NOT, for the same reason as each other: `listTags` and `getLinkGraph`
// report numbers over the whole corpus (counts, totals, degrees, cluster sizes),
// and a number computed over a truncated window would disagree with the list
// beside it — which is itself a private-note oracle. Both pay the full sweep,
// both say so at their definitions, and both belong on a tool a model calls
// once, never in a loop. Since neither can be paginated, both REFUSE above a
// corpus ceiling (MAX_SWEEP_NOTES) rather than block the host thread on a vault
// large enough to make one call take seconds.
// ---------------------------------------------------------------------------

import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  LinkGraph,
  VaultTaskEntry,
  WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import type { PrivacyOpts } from "@repo/notes/knowledge/link-graph-index";
import type { RelatedNoteEntry, RelatedNotesOpts } from "@repo/notes/knowledge/related-notes";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { notePrivacy } from "@repo/notes/markdown/frontmatter";
import { conflictOriginPath } from "@repo/notes/sync/reconcile";
import type { SyncStatus } from "@repo/notes/sync/status";

import { renameWithLinkRewrite } from "../knowledge/rename-rewrite";
import type {
  AgentDelegation,
  AgentGraphCluster,
  AgentGraphHub,
  AgentLinkGraph,
  AgentSyncStatus,
  AgentVaultPort,
  KnowledgePort,
  PrivacyProbe,
  RenameNoteResult,
} from "@repo/agent/extension";
import type { Delegation } from "@repo/bridge/delegation";
import type { SyncConflict } from "@repo/bridge/sync";
import type { VaultEntry, VaultFileFacts } from "@repo/bridge/ipc-registry";
import type { VaultManager } from "@repo/vault/vault";

/** The subject-scoped queries the KnowledgePort wraps — KnowledgeManager
 * (production) and core's KnowledgeIndex (tests) both satisfy it structurally.
 * Split from `VaultQueries` so neither port can name a query it does not
 * project, and a test stub carries no inert members. */
export type KnowledgeQueries = {
  search(query: string, limit?: number, opts?: PrivacyOpts): SearchResult[];
  backlinks(path: string, opts?: PrivacyOpts): BacklinkEntry[];
  /** NOTE the missing PrivacyOpts — unlike its siblings, forwardLinks has no
   * index-level privacy filter, because its other caller is the renderer's
   * Page details sheet, which counts a note's outgoing and unresolved links.
   * That is the USER reading their own file, and the count has to match the
   * bytes on disk or it silently lies. The whole privacy story for this query
   * therefore lives in the port below; do not "fix" the asymmetry by teaching
   * the index to filter without also checking what the renderer would lose. */
  forwardLinks(path: string): ForwardLinkEntry[];
  relatedNotes(path: string, opts?: RelatedNotesOpts): RelatedNoteEntry[];
  notesWithTag(tag: string, opts?: PrivacyOpts): string[];
};

/** The whole-vault reads the AgentVaultPort projects. Each one is a LISTING of
 * the entire corpus, so an ungated call hands over every private note at once
 * rather than one guessed path at a time — which is why the vault port below is
 * the only agent-facing caller they have. `notesWithTag` appears in both types:
 * it answers a tag, but `listTags` needs it to give every count a path behind
 * it to re-probe. */
export type VaultQueries = {
  notesWithTag(tag: string, opts?: PrivacyOpts): string[];
  tasks(opts?: PrivacyOpts): VaultTaskEntry[];
  tags(opts?: PrivacyOpts): TagCount[];
  wikiTargets(opts?: PrivacyOpts): WikiTarget[];
  graph(opts?: PrivacyOpts): LinkGraph;
};

/** The vault reads the listing projections need. `VaultManager` satisfies it
 * structurally, so the port stays constructible over an in-memory fake. */
export type VaultReads = {
  list(): VaultEntry[];
  readText(rel: string): string;
  fileFacts(rel: string): VaultFileFacts | null;
};

const EXCLUDE: PrivacyOpts = { excludePrivate: true };

/** One memo, scoped to ONE port call. The probe is a full file read plus a
 * realpath of the target, and a single query can name the same note many times
 * over — a hub note that links its index twenty times would otherwise pay
 * twenty identical disk round-trips inside one call. Sound because a filter
 * runs to completion synchronously: no write can interleave within a call, so
 * the memo can never answer something the un-memoized probe would not have. It
 * must NOT outlive the call — that is the whole point of the live re-probe
 * (layer 2 in the header). */
function openProbe(probe: (rel: string) => PrivacyProbe): {
  verdict: (rel: string) => PrivacyProbe;
  isPublic: (rel: string) => boolean;
  emittable: (rel: string) => boolean;
} {
  const memo = new Map<string, PrivacyProbe>();
  const verdict = (rel: string): PrivacyProbe => {
    const seen = memo.get(rel);
    if (seen !== undefined) return seen;
    const fresh = probe(rel);
    memo.set(rel, fresh);
    return fresh;
  };
  const isPublic = (rel: string): boolean => verdict(rel) === "public";
  // Emitting a path is a strictly stronger question than reading one, and the
  // difference is the conflict copy: sync names it after the note it forked
  // from, so `secret-plans (conflict …).md` SPELLS a private note's name even
  // when the copy itself holds public bytes. A path the port VOLUNTEERS
  // therefore has to clear its whole ancestry; a path the CALLER already named
  // (readVaultDoc, getVaultFileFacts, and the SUBJECT of backlinks/forwardLinks/
  // relatedNotes) tells it nothing it didn't have, so those keep the plain
  // public check.
  //
  // The walk runs to the root of the chain because one step is not enough: a
  // copy of a copy inverts to another copy, which reads public itself and would
  // spell the private stem anyway. Every ancestor must read public NOW — an
  // absent one fails closed like every other branch here, since moving,
  // renaming or trashing a private note must not un-hide its name through the
  // copy that outlived it. Terminates: each inversion strictly shortens the
  // path.
  //
  // This is the one check here that fails OPEN on drift: change the conflict
  // stamp format and `conflictOriginPath` stops recognizing copies, so every
  // ancestry silently clears. The round-trip against `conflictCopyName` in
  // notes/src/sync/__tests__/reconcile.test.ts is what holds the two halves
  // together — keep them in the same module and keep that test.
  const emittable = (rel: string): boolean => {
    if (!isPublic(rel)) return false;
    let origin = conflictOriginPath(rel);
    while (origin !== null) {
      if (!isPublic(origin)) return false;
      origin = conflictOriginPath(origin);
    }
    return true;
  };
  return { verdict, isPublic, emittable };
}

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
  return {
    search: (query, limit) => {
      const live = openProbe(deps.probe);
      return deps
        .queries()
        .search(query, limit, EXCLUDE)
        .filter((hit) => live.emittable(hit.path));
    },
    backlinks: (path) => {
      const live = openProbe(deps.probe);
      // A private/unreadable TARGET yields [] — silently (see header).
      const target = live.verdict(path);
      if (target === "private" || target === "indeterminate") return [];
      return deps
        .queries()
        .backlinks(path, EXCLUDE)
        .filter((entry) => live.emittable(entry.sourcePath));
    },
    forwardLinks: (path) => {
      const live = openProbe(deps.probe);
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
      // renders it as explicitly unresolved. "absent" fails the check too, so a
      // target deleted since the last index pass drops exactly the way a
      // private one does — that ambiguity is what keeps the omission from being
      // a privacy oracle.
      return deps
        .queries()
        .forwardLinks(path)
        .filter((entry) => entry.targetPath === null || live.emittable(entry.targetPath));
    },
    relatedNotes: (path) => {
      const live = openProbe(deps.probe);
      // A private/unreadable SUBJECT yields [] — silently, exactly like
      // backlinks (see header): "no related notes" never confirms a path.
      const target = live.verdict(path);
      if (target === "private" || target === "indeterminate") return [];
      return deps
        .queries()
        .relatedNotes(path, EXCLUDE)
        .filter((entry) => live.emittable(entry.path));
    },
    notesWithTag: (tag) => {
      const live = openProbe(deps.probe);
      return deps
        .queries()
        .notesWithTag(tag, EXCLUDE)
        .filter((path) => live.emittable(path));
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

// ---------------------------------------------------------------------------
// AgentVaultPort — the whole-vault and host-state reads.
//
// Method names mirror the Bridge methods they project (listVault,
// listVaultTasks, getLinkGraph, …) so a grant table reads as one bridge method
// ↔ one projection, and a method with no projection is visibly ungranted.
// ---------------------------------------------------------------------------

/** Hard ceiling on one probed page — `listVault`, `listVaultTasks`,
 * `listWikiTargets` — and its default. The privacy check is a full file read per
 * DOC row, so an unbounded page reads the whole vault: a 50k-note vault would
 * stall the host for seconds on one tool call. The cap is on the window that
 * gets PROBED, not on the survivors (see listVault). */
const MAX_PAGE_ENTRIES = 200;

/** Clamp a caller's page size into the probe budget. */
function pageLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? MAX_PAGE_ENTRIES, 1), MAX_PAGE_ENTRIES);
}

/** Corpus ceiling for the two sweeps no page can bound (`listTags`,
 * `getLinkGraph`). Both are synchronous and O(vault) — a full probe per note on
 * the host thread, with the renderer's own IPC behind it — so past some size
 * the honest answer is that this question is too expensive to ask, not a UI
 * frozen mid-turn. Deliberately generous: a vault this large is far past where
 * "read everything" was ever the right tool. */
const MAX_SWEEP_NOTES = 2_000;

/** The refusal both sweeps relay verbatim: what happened, the number, and the
 * tool that answers the same question within a page. */
function sweepRefusal(question: string, notes: number): { ok: false; reason: string } {
  return {
    ok: false,
    reason:
      `This vault has ${notes} notes, past the ${MAX_SWEEP_NOTES} this can read in one pass, ` +
      `so ${question} is not available here. Use search_vault, or list_vault with a folder, ` +
      `and answer from a part of the vault instead.`,
  };
}

/** The largest doc `readVaultDoc` will hand back. Everything the port returns
 * lands verbatim in the session transcript and is re-sent with every subsequent
 * turn, so one oversized note is a recurring cost for the whole session. Over
 * the cap reads as absent, like a private note: there is no "too large" in the
 * return type, and a silent truncation would be worse — the model would edit
 * against bytes it thinks are the whole file. */
const MAX_DOC_CHARS = 128 * 1024;

/** Transfer caps for the derived graph answer. Each list is explicitly a
 * SAMPLE, never a complete enumeration, which is also what keeps a privacy drop
 * invisible: a list shorter than its cap is the normal case, so a missing row
 * cannot be read as "something was withheld". */
const MAX_ORPHANS = 50;
const MAX_HUBS = 20;
const MAX_CLUSTERS = 10;
const MAX_CLUSTER_MEMBERS = 20;

// The port's TYPE (and the shapes it returns) lives in @repo/agent/extension —
// the tool layer names them, and agent/ may never import the host. The
// projection ITSELF stays here: the vocabulary is the model's, the disk reads
// and the privacy re-probe are the host's.
//
// `AgentSyncStatus`'s pass-through phases are `Extract`ed from the shared
// `SyncStatus` on purpose: `projectSyncStatus` builds every variant field by
// field, so a field the Bridge adds to `ok` lands as a typecheck failure at the
// construction site rather than a silent new disclosure.

/** The sync state the projection may SEE — deliberately narrower than the
 * Bridge's `SyncState`, which production hands it structurally.
 *
 * The account fields — the email and the session flag — are absent by TYPE
 * rather than dropped by discipline: __tests__/account-boundary.test.ts fences
 * that vocabulary to the sync layer (the account gates cloud saves and nothing
 * else), and a port that cannot name them cannot leak them. The coordinator
 * address goes the same way for a plainer reason — it is infrastructure the
 * model can do nothing with, and everything it sees lands in a transcript. */
export type SyncSummary = {
  enabled: boolean;
  status: SyncStatus;
  conflicts: readonly SyncConflict[];
};

export function buildAgentVaultPort(deps: {
  queries: () => VaultQueries;
  /** LIVE disk probe — the SAME one the KnowledgePort takes. Only "public"
   * passes; absent/indeterminate/private all drop, fail-closed. */
  probe: (rel: string) => PrivacyProbe;
  vault: () => VaultReads;
  sync: () => SyncSummary;
  delegations: () => readonly Delegation[];
}): AgentVaultPort {
  return {
    // A PAGE of the listing: the prefix and the cap are applied to the crawl
    // BEFORE any probing, so the page is `limit` rows no matter how many of them
    // turn out to be private — one read each, plus the conflict ancestry a
    // conflict-named row costs (`emittable`), which is a handful at most.
    //
    // Slicing before filtering is what buys that bound, and it costs something
    // real, stated rather than hidden: the page comes back SHORT, so a caller
    // that asked for a full one learns a row was withheld and can bracket it
    // between its lexicographic neighbours — existence and position, never a
    // name or content. Accepted (docs/privacy.md): the agent's `bash ls` already
    // reads every filename in the vault outright.
    //
    // A non-doc entry passes through UNPROBED and carries only what the crawl
    // knows (path, name, kind): an attachment has no frontmatter, so nothing
    // can mark one private — the same rule wikiTargets applies to assets. It
    // still counts against the limit, so the window stays one flat bounded page.
    listVault: (opts) => {
      const live = openProbe(deps.probe);
      const prefix = normalizeFolder(opts?.folder);
      return deps
        .vault()
        .list()
        .filter((entry) => entry.path.startsWith(prefix))
        .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .slice(0, pageLimit(opts?.limit))
        .filter((entry) => entry.kind !== "doc" || live.emittable(entry.path));
    },

    // The privacy verdict is taken on the BYTES BEING RETURNED, not on a
    // second read of the path. Probe-then-read leaves a window in which the
    // file turns private between the two syscalls and the bytes handed back
    // were never the bytes checked — the one place the port can close its own
    // TOCTOU completely rather than merely narrow it.
    //
    // Missing, non-doc, oversized and private all read as null: "absent" is
    // already the normal answer, so a refusal is indistinguishable from a file
    // that isn't there.
    //
    // The doc gate is not privacy — it is what the method MEANS. The vault
    // confines the path either way, but an attachment read as text is a binary
    // decoded as UTF-8: mojibake in the answer and megabytes in the transcript,
    // for a file no privacy flag can ever guard because it carries no
    // frontmatter. MAX_DOC_CHARS bounds the same cost for a doc.
    readVaultDoc: (path) => {
      if (!isDocPath(path)) return null;
      let text: string;
      try {
        text = deps.vault().readText(path);
      } catch {
        return null;
      }
      if (text.length > MAX_DOC_CHARS) return null;
      return notePrivacy(text) === "public" ? text : null;
    },

    // Size + mtime for one file. null for a private note, which is what a
    // missing file already returns.
    getVaultFileFacts: (path) => {
      const live = openProbe(deps.probe);
      if (!live.isPublic(path)) return null;
      return deps.vault().fileFacts(path);
    },

    // The sharpest whole-vault read: every row carries `raw`, the task's
    // VERBATIM source line, so an ungated answer hands out private note CONTENT
    // rather than merely paths. A bounded page, sliced before probing on the
    // index's own path-then-ordinal order. The window is rows layer (1) already
    // filtered, so unlike listVault's crawl the page is short only where the
    // live probe overrules the index.
    listVaultTasks: (opts) => {
      const live = openProbe(deps.probe);
      const prefix = normalizeFolder(opts?.folder);
      return deps
        .queries()
        .tasks(EXCLUDE)
        .filter((task) => task.path.startsWith(prefix))
        .slice(0, pageLimit(opts?.limit))
        .filter((task) => live.emittable(task.path));
    },

    // Counts are RECOMPUTED over the notes that read public on disk NOW, not
    // filtered: a tag only private notes carry disappears (its NAME is the
    // leak) and a shared one's number describes the public notes alone.
    //
    // One of the two UNBOUNDED sweeps (getLinkGraph is the other): it costs a
    // probe per distinct carrier, and a page cannot fix that — a count taken
    // over a truncated carrier list is simply a wrong count, and the gap
    // between it and the notes behind it is the oracle the recomputation
    // exists to close. The per-call memo makes a note carrying ten tags one
    // read, not ten.
    //
    // The index cannot do this half alone: it filters at index time, so a note
    // saved `private: true` within the refresh debounce still contributes its
    // tag and its +1 with no path for a caller to re-probe. Intersecting
    // against notesWithTag is what gives every count a path behind it.
    //
    // Residual, stated rather than hidden: the DISPLAY CASE still comes from
    // whichever carrier the index saw first among the public ones. If that note
    // turned private in the last ~100ms, the surviving entry renders its
    // capitalization — letter case only, never a path or a count.
    listTags: () => {
      const notes = docCount(deps.vault());
      if (notes > MAX_SWEEP_NOTES) return sweepRefusal("the tag list", notes);
      const queries = deps.queries();
      const live = openProbe(deps.probe);
      const counted: TagCount[] = [];
      for (const { tag } of queries.tags(EXCLUDE)) {
        const count = queries
          .notesWithTag(tag, EXCLUDE)
          .filter((path) => live.emittable(path)).length;
        if (count > 0) counted.push({ tag, count });
      }
      // Mirrors the tag index's own ordering (most-used first, ties
      // alphabetical case-insensitively) — recomputing counts reorders it.
      return {
        ok: true,
        tags: counted.toSorted(
          (a, b) => b.count - a.count || (a.tag.toLowerCase() < b.tag.toLowerCase() ? -1 : 1),
        ),
      };
    },

    // A vault LISTING: a doc's path, title and aliases are all the leak, so a
    // non-public doc drops whole. Assets pass unprobed (no frontmatter). A
    // bounded page over the index's own order (docs first, then assets), sliced
    // before probing — the same window rule as listVaultTasks.
    listWikiTargets: (opts) => {
      const live = openProbe(deps.probe);
      const prefix = normalizeFolder(opts?.folder);
      return deps
        .queries()
        .wikiTargets(EXCLUDE)
        .filter((target) => target.path.startsWith(prefix))
        .slice(0, pageLimit(opts?.limit))
        .filter((target) => target.type !== "doc" || live.emittable(target.path));
    },

    // The second unbounded sweep, and for listTags' reason in its sharpest
    // form: every number it reports (totals, degrees, cluster sizes) must be
    // computed over the same node set its paths come from, or the difference
    // between a count and a list becomes a private-note oracle. So it is
    // O(notes) disk reads per call — expensive on purpose, and the reason this
    // belongs on a tool a model calls once, never in a loop.
    getLinkGraph: () => {
      const notes = docCount(deps.vault());
      if (notes > MAX_SWEEP_NOTES) return sweepRefusal("the link-graph summary", notes);
      const live = openProbe(deps.probe);
      return { ok: true, graph: summarizeGraph(deps.queries().graph(EXCLUDE), live.emittable) };
    },

    getSyncState: () => {
      const live = openProbe(deps.probe);
      const state = deps.sync();
      // Named field by field, never spread: a spread would carry whatever the
      // Bridge's SyncState grows next straight through to the model.
      return {
        enabled: state.enabled,
        status: projectSyncStatus(state.status, live.emittable),
        conflicts: state.conflicts
          .map((conflict) => conflict.path)
          .filter((path) => live.emittable(path)),
      };
    },

    // A delegation record stores `lineText` and `anchor.text` — a raw line
    // lifted from the note when it was created. Privacy is checked at create
    // and at run, NEVER at read, so a note that became private afterwards would
    // otherwise keep a path AND a line of its content readable forever. The
    // whole record drops; the survivors are rebuilt field by field into
    // AgentDelegation, never handed over as the stored record.
    listDelegations: () => {
      const live = openProbe(deps.probe);
      return deps
        .delegations()
        .filter((record) => live.emittable(record.sourceFile))
        .map(
          (record): AgentDelegation => ({
            id: record.id,
            sourceFile: record.sourceFile,
            lineText: record.lineText,
            status: record.status,
            createdAt: record.createdAt,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
            resultSummary: record.resultSummary,
            error: record.error,
          }),
        );
    },
  };
}

/** Notes in the vault, from the listing crawl the host already keeps warm — the
 * gate on the two unbounded sweeps. It counts every doc including private ones:
 * a size check that varied with what the caller may see would report the shape
 * of the private set. */
function docCount(vault: VaultReads): number {
  return vault.list().filter((entry) => entry.kind === "doc").length;
}

/** Normalize a caller's folder argument to a vault-relative prefix ending in
 * "/" (or "" for the whole vault), dropping traversal and empty segments. The
 * prefix only NARROWS a listing the vault already confined, so this is a
 * usability normalization, not the containment boundary. */
function normalizeFolder(folder: string | undefined): string {
  const segments = (folder ?? "")
    .split(/[/\\]/)
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  return segments.length > 0 ? `${segments.join("/")}/` : "";
}

/** Derive the graph answer over the notes that read public on disk NOW.
 *
 * Phantom nodes are dropped whole: a phantom is a dangling `[[link]]` whose id
 * and title ARE the raw link text from a note's body, it names no file that can
 * be opened, and counting one would make a note whose only links dangle look
 * connected. So an orphan here means "no resolved link to another note", which
 * is the question the word is asking. */
function summarizeGraph(graph: LinkGraph, emittable: (rel: string) => boolean): AgentLinkGraph {
  const titles = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.phantom) continue;
    const path = node.path;
    if (path === undefined || !emittable(path)) continue;
    titles.set(node.id, node.title);
  }
  const degree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of titles.keys()) {
    degree.set(id, 0);
    adjacency.set(id, []);
  }
  let totalLinks = 0;
  for (const edge of graph.edges) {
    if (!titles.has(edge.source) || !titles.has(edge.target)) continue;
    // A self-link connects a note to nothing, so it counts nowhere: counting it
    // in the total but not in the degree renders a self-linking note as an
    // orphan that somehow has a link.
    if (edge.source === edge.target) continue;
    totalLinks += 1;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const orphans = [...titles.keys()].filter((id) => (degree.get(id) ?? 0) === 0).toSorted();
  const hubs = [...titles.entries()]
    .map(([path, title]): AgentGraphHub => ({ path, title, degree: degree.get(path) ?? 0 }))
    .filter((hub) => hub.degree > 0)
    .toSorted((a, b) => b.degree - a.degree || (a.path < b.path ? -1 : 1))
    .slice(0, MAX_HUBS);
  return {
    totalNotes: titles.size,
    totalLinks,
    orphans: orphans.slice(0, MAX_ORPHANS),
    hubs,
    clusters: findClusters(adjacency),
  };
}

/** Connected components over the public note-to-note adjacency, largest first.
 * Singletons are omitted — they are exactly the orphans, already reported. */
function findClusters(adjacency: Map<string, string[]>): AgentGraphCluster[] {
  const seen = new Set<string>();
  const clusters: AgentGraphCluster[] = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const members: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      members.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    if (members.length < 2) continue;
    clusters.push({
      size: members.length,
      members: members.toSorted().slice(0, MAX_CLUSTER_MEMBERS),
    });
  }
  return clusters.toSorted((a, b) => b.size - a.size).slice(0, MAX_CLUSTERS);
}

/** The held-pass `sample` is a list of vault paths about to be deleted, so it
 * is filtered like any other path list; it is already a SAMPLE, so a drop reads
 * as the cap doing its job. `deletions` / `baseCount` stay — they are counts
 * over the whole manifest, and a manifest is not privacy-partitioned (sync
 * carries private notes like any other file), which is the accepted hole
 * docs/privacy.md records.
 *
 * Exhaustive with NO default: every variant is enumerated field by field, so a
 * phase or a field the Bridge adds is a typecheck failure here rather than a
 * silent new disclosure. A `default: return status` would be a spread wearing a
 * switch. */
function projectSyncStatus(
  status: SyncStatus,
  emittable: (rel: string) => boolean,
): AgentSyncStatus {
  switch (status.phase) {
    case "idle":
      return { phase: "idle" };
    case "syncing":
      return { phase: "syncing" };
    case "ok":
      return {
        phase: "ok",
        pushed: status.pushed,
        pulled: status.pulled,
        deleted: status.deleted,
        conflicts: status.conflicts,
        merged: status.merged,
      };
    case "held":
      return {
        phase: "held",
        deletions: status.deletions,
        baseCount: status.baseCount,
        sample: status.sample.filter((path) => emittable(path)),
      };
    case "error":
      return { phase: "error" };
  }
}
