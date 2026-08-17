// ---------------------------------------------------------------------------
// LinkGraphIndex — the pure link/tag/title/graph engine, fed DocProjections
// (never raw content, never retaining bodies or line arrays — snippets ride on
// StoredLink). This is the resolution brain both platforms share: the host
// hydrates it from persisted projection rows, the fixture Bridge feeds it
// directly, so the subtle resolver semantics (link-resolve's basename buckets,
// ambiguity, shadowing) exist exactly once and never fork into SQL.
//
// Update model: applyDoc / remove touch one doc's records, and the resolved
// forward/back maps are rebuilt lazily on the first query afterwards — a fold
// over stored links, no re-parsing.
//
// That rebuild is whole-corpus, so it is scoped by what actually invalidates
// it. Resolution depends on exactly two things: the set of vault paths and the
// docs' `aliases:` (link-resolve's five tiers read nothing else). Re-projecting
// a KNOWN doc with an unchanged alias list therefore leaves every OTHER doc's
// resolution — and the resolver itself — correct, so only that doc's own links
// are re-resolved and re-filed. That is the steady state (a note being edited),
// and it is the difference between a per-edit fold over the whole vault and a
// fold over eight links. Anything that moves a path or an alias still forces
// the full rebuild, because it can silently re-point links anywhere in the
// vault (a new `note.md` resolves another doc's dangling `[[note]]`, or makes a
// basename ambiguous).
// ---------------------------------------------------------------------------

import { isDocPath } from "./doc-file";
import type { LinkKind } from "./link-extract";
import type { ExtractedTask } from "./task-ordinal";
import { buildResolver, type TargetResolver } from "./link-resolve";
import type { DocProjection, StoredLink } from "./projection";
import { TagIndex, type TagCount } from "./tag-index";
import { basenamePath, extnamePath } from "./vault-path";

// ---- Wire types (Bridge channel results) ------------------------------------

export type BacklinkEntry = {
  sourcePath: string;
  /** 1-based line of the link in the source doc. */
  line: number;
  /** The source line the link sits on, trimmed. */
  snippet: string;
  kind: LinkKind;
  /** True for `![[transclusions]]`. */
  embed: boolean;
  /** Wiki `|alias` / md link label, when present. */
  alias?: string;
};

export type ForwardLinkEntry = {
  /** Target as written in the doc (decoded for md links). */
  target: string;
  /** Resolved vault path, or null when the link dangles. */
  targetPath: string | null;
  line: number;
  snippet: string;
  kind: LinkKind;
  embed: boolean;
  alias?: string;
  anchor?: string;
};

/** Graph payload shaped for a force-graph renderer: `nodes[].id` is what
 * `edges[].source/target` reference. Real notes use their vault path as id;
 * unresolved targets appear once as flagged phantom nodes. */
export type GraphNode = {
  id: string;
  title: string;
  /** Vault path for real files; absent on phantom (unresolved-target) nodes. */
  path?: string;
  phantom: boolean;
  /** Edges touching the node, self-links counted once. */
  degree: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: LinkKind;
  /** Parallel links between the same pair collapse into one edge with a count. */
  count: number;
};

export type LinkGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** A `[[` picker entry: notes AND attachments suggest (Obsidian-style); the
 * `type` flag lets the picker group them and insert `![[..]]` for assets.
 * `aliases` (docs only, when non-empty) feed the picker's match keywords and
 * a client's local resolver. */
export type WikiTarget = { path: string; title: string; type: "doc" | "asset"; aliases?: string[] };

/** One vault task: an ExtractedTask flattened with its doc's identity, so a
 * caller listing across the vault keeps the (path, ordinal) that names it. */
export type VaultTaskEntry = {
  path: string;
  title: string;
  line: number;
  raw: string;
  text: string;
  checked: boolean;
  ordinal: number;
};

// ---- Engine ------------------------------------------------------------------

type DocRecord = {
  title: string;
  links: StoredLink[];
  aliases: string[];
  tasks: ExtractedTask[];
  /** Corpus position, assigned when the path first enters `docs` and kept
   * across re-projections — `docs` is a Map, so re-setting a live key holds
   * its slot. It IS the doc iteration order, which is what a from-scratch
   * resolution files backlink occurrences in; carrying it on the occurrence
   * lets an incremental re-file land in that same order. */
  seq: number;
};

type ResolvedLink = { link: StoredLink; targetPath: string | null };

/** One inbound link, ordered by its source's corpus position. */
type Occurrence = { sourcePath: string; link: StoredLink; seq: number };

type ResolvedState = {
  /** Valid for exactly as long as the path/alias namespace is unchanged. */
  resolver: TargetResolver;
  forward: Map<string, ResolvedLink[]>;
  /** target path → inbound occurrences, in corpus order. */
  backlinks: Map<string, Occurrence[]>;
};

/** Above this many docs waiting to be re-resolved, rebuild from scratch
 * instead. Re-filing one doc splices into each of its targets' occurrence
 * lists, so the incremental cost is O(docs × out-degree × in-degree) — no bound
 * in terms of the corpus, where the fold is a flat O(corpus). The cap sits at
 * the crossover for the worst realistic shape, a hub every note links to: over
 * 20k docs with a 20k-in-degree hub, re-filing 256 docs costs about what the
 * fold does (227ms vs 202ms), and an ordinary corpus is two orders cheaper
 * again. */
const MAX_INCREMENTAL_DOCS = 256;

export class LinkGraphIndex {
  private readonly docs = new Map<string, DocRecord>();
  private readonly others = new Set<string>();
  private readonly tagIndex = new TagIndex();
  private resolved: ResolvedState | null = null;
  /** Docs re-projected under an unchanged namespace since `resolved` was
   * built — only their own links need re-resolving. Meaningless (and cleared)
   * whenever `resolved` is dropped. */
  private readonly pendingDocs = new Set<string>();
  /** Monotonic source of {@link DocRecord.seq}. */
  private nextSeq = 0;

  /** Index (or re-index) a markdown doc from its projection. */
  applyDoc(path: string, projection: DocProjection): void {
    this.others.delete(path);
    const prior = this.docs.get(path);
    this.docs.set(path, {
      title: projection.title,
      links: projection.links,
      aliases: projection.aliases,
      tasks: projection.tasks,
      seq: prior?.seq ?? this.nextSeq++,
    });
    this.tagIndex.set(path, projection.tags);
    // A known doc keeping its aliases leaves the namespace — and so every
    // other doc's resolution — intact; anything else can re-point links
    // vault-wide (see the header).
    if (prior !== undefined && sameStrings(prior.aliases, projection.aliases)) {
      if (this.resolved !== null) this.pendingDocs.add(path);
    } else {
      this.dropResolution();
    }
  }

  /** Register a non-doc vault file (image, pdf, …) for link resolution only. */
  setOther(path: string): void {
    if (this.docs.delete(path)) this.tagIndex.remove(path);
    this.others.add(path);
    this.dropResolution();
  }

  /** Drop a file (doc or other) from the index. */
  remove(path: string): void {
    const wasDoc = this.docs.delete(path);
    if (wasDoc) this.tagIndex.remove(path);
    const wasOther = this.others.delete(path);
    if (wasDoc || wasOther) this.dropResolution();
  }

  clear(): void {
    this.docs.clear();
    this.others.clear();
    this.tagIndex.clear();
    this.dropResolution();
  }

  // ---- Queries ---------------------------------------------------------------

  /** The indexed doc's title, or null for unknown/non-doc paths. */
  titleOf(path: string): string | null {
    return this.docs.get(path)?.title ?? null;
  }

  backlinks(path: string): BacklinkEntry[] {
    const occurrences = this.ensureResolved().backlinks.get(path) ?? [];
    return occurrences.map(({ sourcePath, link }) => {
      const entry: BacklinkEntry = {
        sourcePath,
        line: link.line,
        snippet: link.snippet,
        kind: link.kind,
        embed: link.embed,
      };
      if (link.alias !== undefined) entry.alias = link.alias;
      return entry;
    });
  }

  forwardLinks(path: string): ForwardLinkEntry[] {
    const links = this.ensureResolved().forward.get(path) ?? [];
    return links.map(({ link, targetPath }) => {
      const entry: ForwardLinkEntry = {
        target: link.target,
        targetPath,
        line: link.line,
        snippet: link.snippet,
        kind: link.kind,
        embed: link.embed,
      };
      if (link.alias !== undefined) entry.alias = link.alias;
      if (link.anchor !== undefined) entry.anchor = link.anchor;
      return entry;
    });
  }

  graph(): LinkGraph {
    const { forward } = this.ensureResolved();
    const nodes = new Map<string, GraphNode>();
    for (const [path, record] of this.docs) {
      nodes.set(path, { id: path, title: record.title, path, phantom: false, degree: 0 });
    }
    const edges: GraphEdge[] = [];
    // Parallel links collapse per SOURCE, and `forward` is already grouped by
    // source, so the dedupe map is scoped to the current source and holds a
    // handful of short keys. Keying one vault-wide map on a concatenated path
    // PAIR is the same answer for ~50% more time at 400k links — the scoping is
    // load-bearing, not tidiness.
    const bySource = new Map<string, GraphEdge>();
    for (const [sourcePath, links] of forward) {
      bySource.clear();
      const sourceNode = nodes.get(sourcePath);
      for (const { link, targetPath } of links) {
        // The graph is a NOTES graph: asset references (md images, `![[x.png]]`
        // embeds, `[pdf](x.pdf)` links) are content inside a note, not
        // knowledge edges between notes — they stay out so the graph doesn't
        // silt up with attachment leaves. backlinks() still answers asset
        // queries; only the graph filters.
        if (link.kind === "image") continue;
        let targetId: string;
        if (targetPath !== null) {
          if (!this.docs.has(targetPath)) continue; // resolved asset target
          targetId = targetPath;
        } else {
          // A dangling target written with a non-doc extension is an asset
          // reference too — no phantom "create this note" node for it.
          const ext = extnamePath(link.target);
          if (ext !== "" && !isDocPath(link.target)) continue;
          targetId = `phantom:${link.target.toLowerCase()}`;
          if (!nodes.has(targetId)) {
            nodes.set(targetId, { id: targetId, title: link.target, phantom: true, degree: 0 });
          }
        }
        const key = `${link.kind}\u0000${targetId}`;
        const seen = bySource.get(key);
        if (seen !== undefined) {
          seen.count += 1;
          continue;
        }
        const edge: GraphEdge = { source: sourcePath, target: targetId, kind: link.kind, count: 1 };
        bySource.set(key, edge);
        edges.push(edge);
        // Degree counts EDGES, not link occurrences — so it moves only here,
        // where a new pair is created, and once for a self-edge.
        if (sourceNode) sourceNode.degree += 1;
        if (targetId !== sourcePath) {
          const targetNode = nodes.get(targetId);
          if (targetNode) targetNode.degree += 1;
        }
      }
    }
    return { nodes: [...nodes.values()], edges };
  }

  /** Docs first (title-bearing), assets after — the picker renders them as
   * two groups in this order. */
  wikiTargets(): WikiTarget[] {
    const docs: WikiTarget[] = [];
    for (const [path, record] of this.docs) {
      const target: WikiTarget = { path, title: record.title, type: "doc" };
      if (record.aliases.length > 0) target.aliases = record.aliases;
      docs.push(target);
    }
    const assets = [...this.others].map(
      (path): WikiTarget => ({ path, title: basenamePath(path), type: "asset" }),
    );
    return [...docs.toSorted(byPath), ...assets.toSorted(byPath)];
  }

  /** Every tag in the vault with its note count (most-used first). Fed by both
   * inline `#tags` and the frontmatter `tags` property, unified case-insensitively. */
  tags(): TagCount[] {
    return this.tagIndex.all();
  }

  /** Every task in the vault, sorted by path then ordinal — the Tasks view's
   * whole-vault query. A flatten over stored projections, no resolution pass
   * (tasks don't participate in ensureResolved). */
  tasks(): VaultTaskEntry[] {
    const out: VaultTaskEntry[] = [];
    for (const [path, record] of [...this.docs.entries()].toSorted(byKey)) {
      for (const task of record.tasks) {
        out.push({
          path,
          title: record.title,
          line: task.line,
          raw: task.raw,
          text: task.text,
          checked: task.checked,
          ordinal: task.ordinal,
        });
      }
    }
    return out;
  }

  /** One doc's tags in display case (empty for unknown paths). */
  tagsOf(path: string): string[] {
    return this.tagIndex.tagsOf(path);
  }

  /** Vault paths of notes carrying `tag` (case-insensitive), sorted. */
  notesWithTag(tag: string): string[] {
    return this.tagIndex.notesWithTag(tag);
  }

  // ---- Internals --------------------------------------------------------------

  private dropResolution(): void {
    this.resolved = null;
    this.pendingDocs.clear();
  }

  private ensureResolved(): ResolvedState {
    const current = this.resolved;
    if (current !== null && this.applyPending(current)) return current;
    // Alias entries feed the resolver's below-path tiers, so `[[alias]]`
    // links resolve in backlinks/forward-links/graph exactly like the
    // client's local resolver (which pulls the same aliases via
    // listWikiTargets).
    const aliasEntries: Array<readonly [string, string]> = [];
    for (const [path, record] of this.docs) {
      for (const alias of record.aliases) aliasEntries.push([alias, path]);
    }
    const resolver = buildResolver([...this.docs.keys(), ...this.others], aliasEntries);
    const forward = new Map<string, ResolvedLink[]>();
    const backlinks: ResolvedState["backlinks"] = new Map();
    for (const [sourcePath, record] of this.docs) {
      const resolvedLinks = this.resolveLinks(resolver, sourcePath, record);
      forward.set(sourcePath, resolvedLinks);
      for (const { link, targetPath } of resolvedLinks) {
        if (targetPath === null) continue;
        const list = backlinks.get(targetPath);
        const occurrence: Occurrence = { sourcePath, link, seq: record.seq };
        if (list) list.push(occurrence);
        else backlinks.set(targetPath, [occurrence]);
      }
    }
    this.resolved = { resolver, forward, backlinks };
    this.pendingDocs.clear();
    return this.resolved;
  }

  private resolveLinks(
    resolver: TargetResolver,
    sourcePath: string,
    record: DocRecord,
  ): ResolvedLink[] {
    return record.links.map((link) => ({
      link,
      targetPath:
        link.kind === "wiki"
          ? resolver.resolveWiki(link.target)
          : resolver.resolveMd(link.target, sourcePath),
    }));
  }

  /** Fold the pending docs into an otherwise-valid `state`, producing exactly
   * what a from-scratch resolution would. False means "give up and rebuild" —
   * either too many docs are pending to be worth splicing, or a pending doc
   * has no prior forward entry (it predates this state, so its position among
   * the occurrences is not known). */
  private applyPending(state: ResolvedState): boolean {
    if (this.pendingDocs.size === 0) return true;
    if (this.pendingDocs.size > MAX_INCREMENTAL_DOCS) return false;
    for (const path of this.pendingDocs) {
      const record = this.docs.get(path);
      const stale = state.forward.get(path);
      if (record === undefined || stale === undefined) return false;
      // Retract every occurrence this doc contributed, target by target…
      const touched = new Set<string>();
      for (const { targetPath } of stale) {
        if (targetPath !== null) touched.add(targetPath);
      }
      for (const target of touched) {
        const kept = state.backlinks.get(target)?.filter((o) => o.sourcePath !== path);
        if (kept === undefined) continue;
        if (kept.length === 0) state.backlinks.delete(target);
        else state.backlinks.set(target, kept);
      }
      // …then re-resolve and re-file at the doc's own corpus position. The
      // Map keeps its slot, so `forward` iteration order is untouched.
      const links = this.resolveLinks(state.resolver, path, record);
      state.forward.set(path, links);
      for (const { link, targetPath } of links) {
        if (targetPath === null) continue;
        fileOccurrence(state.backlinks, targetPath, { sourcePath: path, link, seq: record.seq });
      }
    }
    this.pendingDocs.clear();
    return true;
  }
}

/** Insert `occurrence` keeping the target's list in corpus order. Equal seqs
 * (the same doc's own links, re-filed in link order) append after each other,
 * which is the order a from-scratch build emits them in. */
function fileOccurrence(
  backlinks: Map<string, Occurrence[]>,
  target: string,
  occurrence: Occurrence,
): void {
  const list = backlinks.get(target);
  if (list === undefined) {
    backlinks.set(target, [occurrence]);
    return;
  }
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const at = list[mid];
    if (at !== undefined && at.seq <= occurrence.seq) low = mid + 1;
    else high = mid;
  }
  list.splice(low, 0, occurrence);
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}

function byPath(a: WikiTarget, b: WikiTarget): number {
  return a.path < b.path ? -1 : 1;
}

function byKey(a: readonly [string, unknown], b: readonly [string, unknown]): number {
  return a[0] < b[0] ? -1 : 1;
}
