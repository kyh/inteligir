// ---------------------------------------------------------------------------
// LinkGraphIndex — the pure link/tag/title/graph engine, fed DocProjections
// (never raw content, never retaining bodies or line arrays — snippets ride on
// StoredLink). This is the resolution brain both platforms share: the host
// hydrates it from persisted projection rows, the dev harness feeds it
// directly, so the subtle resolver semantics (link-resolve's basename buckets,
// ambiguity, shadowing) exist exactly once and never fork into SQL.
//
// Update model: applyDoc / remove touch one doc's records. Link RESOLUTION is
// global (adding `note.md` can resolve another doc's dangling `[[note]]`, or
// make a basename ambiguous), so the resolved forward/back maps are rebuilt
// lazily on the first query after any mutation — a cheap fold over stored
// links, no re-parsing.
// ---------------------------------------------------------------------------

import { isDocPath } from "./doc-file";
import type { LinkKind } from "./link-extract";
import { buildResolver } from "./link-resolve";
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
  /** Total edges touching the node (node sizing). */
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
 * the renderer's local resolver. */
export type WikiTarget = { path: string; title: string; type: "doc" | "asset"; aliases?: string[] };

// ---- Engine ------------------------------------------------------------------

/** Query option shared by the privacy-filterable reads. Default false keeps
 * renderer surfaces (backlinks panel, palette, graph) seeing everything —
 * private notes are the user's own screen; only AGENT-facing callers pass
 * true, and they re-probe live disk on top (the index only prefilters). */
export type PrivacyOpts = { excludePrivate?: boolean };

type DocRecord = { title: string; links: StoredLink[]; aliases: string[]; private: boolean };

type ResolvedLink = { link: StoredLink; targetPath: string | null };

type ResolvedState = {
  forward: Map<string, ResolvedLink[]>;
  /** target path → [source path, link] occurrences. */
  backlinks: Map<string, Array<{ sourcePath: string; link: StoredLink }>>;
};

export class LinkGraphIndex {
  private readonly docs = new Map<string, DocRecord>();
  private readonly others = new Set<string>();
  private readonly tagIndex = new TagIndex();
  private resolved: ResolvedState | null = null;

  /** Index (or re-index) a markdown doc from its projection. */
  applyDoc(path: string, projection: DocProjection): void {
    this.others.delete(path);
    this.docs.set(path, {
      title: projection.title,
      links: projection.links,
      aliases: projection.aliases,
      private: projection.private,
    });
    this.tagIndex.set(path, projection.tags);
    this.resolved = null;
  }

  /** Register a non-doc vault file (image, pdf, …) for link resolution only. */
  setOther(path: string): void {
    if (this.docs.delete(path)) this.tagIndex.remove(path);
    this.others.add(path);
    this.resolved = null;
  }

  /** Drop a file (doc or other) from the index. */
  remove(path: string): void {
    const wasDoc = this.docs.delete(path);
    if (wasDoc) this.tagIndex.remove(path);
    const wasOther = this.others.delete(path);
    if (wasDoc || wasOther) this.resolved = null;
  }

  clear(): void {
    this.docs.clear();
    this.others.clear();
    this.tagIndex.clear();
    this.resolved = null;
  }

  // ---- Queries ---------------------------------------------------------------

  /** The indexed doc's title, or null for unknown/non-doc paths. */
  titleOf(path: string): string | null {
    return this.docs.get(path)?.title ?? null;
  }

  /** Whether the indexed doc carries `private: true` (or unreadable
   * frontmatter — fail-closed). `undefined` = not an indexed doc. */
  isPrivate(path: string): boolean | undefined {
    return this.docs.get(path)?.private;
  }

  /** Vault paths of every indexed private doc, sorted — the prefilter the
   * agent gate's best-effort bash/execute heuristics scan. */
  privatePaths(): string[] {
    return [...this.docs.entries()]
      .filter(([, record]) => record.private)
      .map(([path]) => path)
      .toSorted();
  }

  backlinks(path: string, opts?: PrivacyOpts): BacklinkEntry[] {
    // A private TARGET yields nothing at all under excludePrivate — the drop
    // is silent (indistinguishable from "no backlinks") so the response never
    // confirms the path exists, matching search's drop-entirely rule.
    if (opts?.excludePrivate === true && this.docs.get(path)?.private === true) return [];
    let occurrences = this.ensureResolved().backlinks.get(path) ?? [];
    if (opts?.excludePrivate === true) {
      // A backlink FROM a private note leaks its path + snippet — drop those.
      occurrences = occurrences.filter(
        ({ sourcePath }) => this.docs.get(sourcePath)?.private !== true,
      );
    }
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
    const edgeMap = new Map<string, GraphEdge>();
    for (const [sourcePath, links] of forward) {
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
        const key = `${sourcePath}\u0000${targetId}\u0000${link.kind}`;
        const edge = edgeMap.get(key);
        if (edge) edge.count += 1;
        else edgeMap.set(key, { source: sourcePath, target: targetId, kind: link.kind, count: 1 });
      }
    }
    for (const edge of edgeMap.values()) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (source) source.degree += 1;
      if (target && edge.target !== edge.source) target.degree += 1;
    }
    return { nodes: [...nodes.values()], edges: [...edgeMap.values()] };
  }

  /** Docs first (title-bearing), assets after — the picker renders them as
   * two groups in this order. */
  wikiTargets(): WikiTarget[] {
    const docs = [...this.docs.entries()].map(([path, record]): WikiTarget => {
      const target: WikiTarget = { path, title: record.title, type: "doc" };
      if (record.aliases.length > 0) target.aliases = record.aliases;
      return target;
    });
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

  /** Vault paths of notes carrying `tag` (case-insensitive), sorted. */
  notesWithTag(tag: string, opts?: PrivacyOpts): string[] {
    const paths = this.tagIndex.notesWithTag(tag);
    if (opts?.excludePrivate !== true) return paths;
    return paths.filter((path) => this.docs.get(path)?.private !== true);
  }

  // ---- Internals --------------------------------------------------------------

  private ensureResolved(): ResolvedState {
    if (this.resolved) return this.resolved;
    const resolver = buildResolver([...this.docs.keys(), ...this.others]);
    const forward = new Map<string, ResolvedLink[]>();
    const backlinks: ResolvedState["backlinks"] = new Map();
    for (const [sourcePath, record] of this.docs) {
      const resolvedLinks: ResolvedLink[] = record.links.map((link) => ({
        link,
        targetPath:
          link.kind === "wiki"
            ? resolver.resolveWiki(link.target)
            : resolver.resolveMd(link.target, sourcePath),
      }));
      forward.set(sourcePath, resolvedLinks);
      for (const { link, targetPath } of resolvedLinks) {
        if (targetPath === null) continue;
        const list = backlinks.get(targetPath);
        const occurrence = { sourcePath, link };
        if (list) list.push(occurrence);
        else backlinks.set(targetPath, [occurrence]);
      }
    }
    this.resolved = { forward, backlinks };
    return this.resolved;
  }
}

function byPath(a: WikiTarget, b: WikiTarget): number {
  return a.path < b.path ? -1 : 1;
}
