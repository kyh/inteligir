// ---------------------------------------------------------------------------
// KnowledgeIndex — the self-contained, dependency-free composition of the
// vault knowledge engine: LinkGraphIndex (links/tags/graph, fed projections)
// plus the pure in-memory SearchIndex, driven directly from doc content.
//
// Production composes LinkGraphIndex with a persistent KnowledgeStore instead —
// FTS5 search, projections hydrated from storage. This class remains the
// zero-install reference composition: it pins the
// engine's behavior in core tests and stays the drop-in for any future surface
// (React Native) that can't carry a SQLite binding.
//
// DO NOT DELETE it as "unused in production".
// @repo/notes carries no sqlite dependency ON PURPOSE (it is the pure sharing
// seam; SqlDriver is injected by each platform), so this is the ONLY way the
// package can test its own knowledge engine. Roughly a thousand lines of tests
// for related-notes scoring, the tag index, the link graph and the perf oracle
// drive production logic THROUGH it. Removing it would force a sqlite
// devDependency into the pure package or exile those tests to the node host.
// Its ~200 lines are the cheap side of that trade.
// ---------------------------------------------------------------------------

import { LinkGraphIndex } from "./link-graph-index";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  LinkGraph,
  VaultTaskEntry,
  WikiTarget,
} from "./link-graph-index";
import { titleFromPath } from "./link-extract";
import { clipSnippet, projectDoc } from "./projection";
import { splitLines } from "./source-lines";
import { relatedNotes, type RelatedNoteEntry, type RelatedNotesOpts } from "./related-notes";
import { SearchIndex, tokenize } from "./search-index";
import type { TagCount } from "./tag-index";

export type SearchResult = { path: string; title: string; snippet: string; score: number };

export const SEARCH_DEFAULT_LIMIT = 20;

export class KnowledgeIndex {
  private readonly linkGraph = new LinkGraphIndex();
  private readonly searchIndex = new SearchIndex();
  /** Doc source lines, retained for search()'s matching-line snippets only —
   * link/backlink snippets are captured per-link at projection time. */
  private readonly lines = new Map<string, string[]>();

  /** Index (or re-index) a markdown doc. */
  setDoc(path: string, content: string): void {
    const projection = projectDoc(path, content);
    this.lines.set(path, splitLines(content));
    this.linkGraph.applyDoc(path, projection);
    this.searchIndex.set(path, {
      title: projection.title,
      // Aliases ride the headings field — a ranking boost only (their bytes
      // already match via the body); the SQL store's FTS insert mirrors this.
      headings: [...projection.headings, ...projection.aliases],
      body: content,
    });
  }

  /** Register a non-doc vault file (image, pdf, …) for link resolution only. */
  setOther(path: string): void {
    if (this.lines.delete(path)) this.searchIndex.remove(path);
    this.linkGraph.setOther(path);
  }

  /** Drop a file (doc or other) from the index. */
  remove(path: string): void {
    if (this.lines.delete(path)) this.searchIndex.remove(path);
    this.linkGraph.remove(path);
  }

  clear(): void {
    this.lines.clear();
    this.searchIndex.clear();
    this.linkGraph.clear();
  }

  // ---- Queries ---------------------------------------------------------------

  backlinks(path: string): BacklinkEntry[] {
    return this.linkGraph.backlinks(path);
  }

  forwardLinks(path: string): ForwardLinkEntry[] {
    return this.linkGraph.forwardLinks(path);
  }

  graph(): LinkGraph {
    return this.linkGraph.graph();
  }

  wikiTargets(): WikiTarget[] {
    return this.linkGraph.wikiTargets();
  }

  search(query: string, limit: number = SEARCH_DEFAULT_LIMIT): SearchResult[] {
    const tokens = tokenize(query);
    const ranked = this.searchIndex.search(query, limit);
    return ranked.map(({ path, score }) => ({
      path,
      title: this.linkGraph.titleOf(path) ?? titleFromPath(path),
      snippet: this.searchSnippet(path, tokens),
      score,
    }));
  }

  tags(): TagCount[] {
    return this.linkGraph.tags();
  }

  tasks(): VaultTaskEntry[] {
    return this.linkGraph.tasks();
  }

  notesWithTag(tag: string): string[] {
    return this.linkGraph.notesWithTag(tag);
  }

  /** Ranked related notes (shared links, co-citation, shared tags, lexical
   * similarity via the in-memory SearchIndex) — see related-notes.ts. */
  relatedNotes(path: string, opts?: RelatedNotesOpts): RelatedNoteEntry[] {
    return relatedNotes(
      this.linkGraph,
      (query, limit) => this.searchIndex.search(query, limit),
      path,
      opts,
    );
  }

  // ---- Internals --------------------------------------------------------------

  /** First line containing a query token; falls back to the title. */
  private searchSnippet(path: string, tokens: string[]): string {
    const lines = this.lines.get(path);
    if (!lines) return "";
    for (const raw of lines) {
      const line = raw.trim();
      if (line === "") continue;
      const lower = line.toLowerCase();
      if (tokens.some((token) => lower.includes(token))) return clipSnippet(line);
    }
    return this.linkGraph.titleOf(path) ?? "";
  }
}
