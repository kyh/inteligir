// Not dead code: @repo/notes carries no sqlite dependency, so this in-memory
// composition is the only way the package's own suites (related-notes, tags,
// link graph) can drive the knowledge engine. Production composes
// LinkGraphIndex with a KnowledgeStore instead.

import { LinkGraphIndex } from "./link-graph-index";
import type { BacklinkEntry, ForwardLinkEntry, LinkGraph, WikiTarget } from "./link-graph-index";
import { docStem } from "./doc-file";
import { projectDoc } from "./projection";
import { splitLines } from "./source-lines";
import { relatedNotes, type RelatedNoteEntry, type RelatedNotesOpts } from "./related-notes";
import { SearchIndex } from "./search-index";
import { searchExcerpt } from "./search-excerpt";
import { planSearchQuery, type SearchQueryTerm } from "./search-query";
import type { TagCount } from "./tag-index";

export type SearchResult = { path: string; title: string; snippet: string; score: number };

export const SEARCH_DEFAULT_LIMIT = 20;

export class KnowledgeIndex {
  private readonly linkGraph = new LinkGraphIndex();
  private readonly searchIndex = new SearchIndex();
  private readonly lines = new Map<string, string[]>();

  setDoc(path: string, content: string): void {
    const projection = projectDoc(path, content);
    this.lines.set(path, splitLines(content));
    this.linkGraph.applyDoc(path, projection);
    this.searchIndex.set(path, {
      title: projection.title,
      // aliases ride the headings field as a ranking boost; sql-knowledge-store's fts insert must match
      headings: [...projection.headings, ...projection.aliases],
      body: content,
    });
  }

  setOther(path: string): void {
    if (this.lines.delete(path)) this.searchIndex.remove(path);
    this.linkGraph.setOther(path);
  }

  remove(path: string): void {
    if (this.lines.delete(path)) this.searchIndex.remove(path);
    this.linkGraph.remove(path);
  }

  clear(): void {
    this.lines.clear();
    this.searchIndex.clear();
    this.linkGraph.clear();
  }

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
    // every plan in the ladder shares one term list, so the first plan's terms serve the excerpt
    const [plan] = planSearchQuery(query);
    const terms = plan?.terms ?? [];
    const ranked = this.searchIndex.search(query, limit);
    return ranked.map(({ path, score }) => ({
      path,
      title: this.linkGraph.titleOf(path) ?? docStem(path),
      snippet: this.searchSnippet(path, terms),
      score,
    }));
  }

  tags(): TagCount[] {
    return this.linkGraph.tags();
  }

  notesWithTag(tag: string): string[] {
    return this.linkGraph.notesWithTag(tag);
  }

  relatedNotes(path: string, opts?: RelatedNotesOpts): RelatedNoteEntry[] {
    return relatedNotes(
      this.linkGraph,
      (query, limit) => this.searchIndex.search(query, limit),
      path,
      opts,
    );
  }

  private searchSnippet(path: string, terms: readonly SearchQueryTerm[]): string {
    const lines = this.lines.get(path);
    if (!lines) return "";
    return searchExcerpt(lines, terms) || (this.linkGraph.titleOf(path) ?? "");
  }
}
