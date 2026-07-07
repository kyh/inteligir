// ---------------------------------------------------------------------------
// The vault knowledge engine: link index + lexical search over a set of docs.
// Pure and environment-free so the host (real vault + watcher) and the dev
// harness's fixture bridge (in-memory Map) run the SAME engine — the wire
// types the Bridge channels return are defined here.
//
// Update model: doc parsing (the expensive part) is incremental — setDoc /
// remove touch one doc's extraction + search postings. Link RESOLUTION is
// global (adding `note.md` can resolve another doc's dangling `[[note]]`, or
// make a basename ambiguous), so the resolved forward/back maps are rebuilt
// lazily on the first query after any mutation — a cheap fold over stored
// raw links, no re-parsing.
// ---------------------------------------------------------------------------

import { isDocPath } from "./doc-file";
import type { ExtractedLink, LinkKind } from "./link-extract";
import { scanDoc, titleFromPath } from "./link-extract";
import { buildResolver } from "./link-resolve";
import { SearchIndex, tokenize } from "./search-index";
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

export type SearchResult = { path: string; title: string; snippet: string; score: number };

/** A `[[` picker entry: notes AND attachments suggest (Obsidian-style); the
 * `type` flag lets the picker group them and insert `![[..]]` for assets. */
export type WikiTarget = { path: string; title: string; type: "doc" | "asset" };

export const SEARCH_DEFAULT_LIMIT = 20;
const SNIPPET_MAX = 200;

// ---- Engine ------------------------------------------------------------------

type DocRecord = {
  lines: string[];
  title: string;
  headings: string[];
  links: ExtractedLink[];
};

type ResolvedLink = { link: ExtractedLink; targetPath: string | null };

type ResolvedState = {
  forward: Map<string, ResolvedLink[]>;
  /** target path → [source path, link] occurrences. */
  backlinks: Map<string, Array<{ sourcePath: string; link: ExtractedLink }>>;
};

export class KnowledgeIndex {
  private readonly docs = new Map<string, DocRecord>();
  private readonly others = new Set<string>();
  private readonly searchIndex = new SearchIndex();
  private resolved: ResolvedState | null = null;

  /** Index (or re-index) a markdown doc. */
  setDoc(path: string, content: string): void {
    this.others.delete(path);
    const scan = scanDoc(content);
    const title = scan.title ?? titleFromPath(path);
    this.docs.set(path, {
      lines: content.split(/\r\n|\r|\n/),
      title,
      headings: scan.headings,
      links: scan.links,
    });
    this.searchIndex.set(path, { title, headings: scan.headings, body: content });
    this.resolved = null;
  }

  /** Register a non-doc vault file (image, pdf, …) for link resolution only. */
  setOther(path: string): void {
    if (this.docs.has(path)) {
      this.docs.delete(path);
      this.searchIndex.remove(path);
    }
    this.others.add(path);
    this.resolved = null;
  }

  /** Drop a file (doc or other) from the index. */
  remove(path: string): void {
    const wasDoc = this.docs.delete(path);
    if (wasDoc) this.searchIndex.remove(path);
    const wasOther = this.others.delete(path);
    if (wasDoc || wasOther) this.resolved = null;
  }

  clear(): void {
    this.docs.clear();
    this.others.clear();
    this.searchIndex.clear();
    this.resolved = null;
  }

  // ---- Queries ---------------------------------------------------------------

  backlinks(path: string): BacklinkEntry[] {
    const occurrences = this.ensureResolved().backlinks.get(path) ?? [];
    return occurrences.map(({ sourcePath, link }) => {
      const entry: BacklinkEntry = {
        sourcePath,
        line: link.line,
        snippet: this.lineSnippet(sourcePath, link.line),
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
        snippet: this.lineSnippet(path, link.line),
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
    const docs = [...this.docs.entries()].map(
      ([path, record]): WikiTarget => ({ path, title: record.title, type: "doc" }),
    );
    const assets = [...this.others].map(
      (path): WikiTarget => ({ path, title: basenamePath(path), type: "asset" }),
    );
    return [...docs.toSorted(byPath), ...assets.toSorted(byPath)];
  }

  search(query: string, limit: number = SEARCH_DEFAULT_LIMIT): SearchResult[] {
    const tokens = tokenize(query);
    return this.searchIndex.search(query, limit).map(({ path, score }) => ({
      path,
      title: this.docs.get(path)?.title ?? titleFromPath(path),
      snippet: this.searchSnippet(path, tokens),
      score,
    }));
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

  private lineSnippet(path: string, line: number): string {
    const text = this.docs.get(path)?.lines[line - 1] ?? "";
    return clip(text.trim());
  }

  /** First line containing a query token; falls back to the title. */
  private searchSnippet(path: string, tokens: string[]): string {
    const record = this.docs.get(path);
    if (!record) return "";
    for (const raw of record.lines) {
      const line = raw.trim();
      if (line === "") continue;
      const lower = line.toLowerCase();
      if (tokens.some((token) => lower.includes(token))) return clip(line);
    }
    return record.title;
  }
}

function clip(text: string): string {
  return text.length <= SNIPPET_MAX ? text : `${text.slice(0, SNIPPET_MAX - 1)}…`;
}

function byPath(a: WikiTarget, b: WikiTarget): number {
  return a.path < b.path ? -1 : 1;
}
