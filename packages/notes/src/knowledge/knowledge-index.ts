// Not dead code: @repo/notes carries no sqlite dependency, so this in-memory
// composition is the only way the package's own suites (related-notes, tags,
// link graph) can drive the knowledge engine. Production composes
// LinkGraphIndex with a KnowledgeStore instead.

import { LinkGraphIndex } from "./link-graph-index";
import type { BacklinkEntry, ForwardLinkEntry, WikiTarget } from "./link-graph-index";
import { docStem } from "./doc-file";
import { projectDoc } from "./projection";
import { relatedNotes } from "./related-notes";
import type { RelatedNoteEntry, RelatedNotesOpts } from "./related-notes";
import { searchFieldsOf } from "./search-columns";
import { SearchIndex } from "./search-index";
import { searchExcerpt } from "./search-excerpt";
import { planSearchQuery, SEARCH_DEFAULT_LIMIT } from "./search-query";
import type { SearchQueryTerm, SearchResult } from "./search-query";
import type { TagCount } from "./tag-index";
import { notesInTagFamily } from "./tag-notes";
import { collectVaultMatches } from "./text-matches";
import type { TextMatchOptions, VaultMatches } from "./text-matches";
import { collectVaultProblems } from "./vault-problems";
import type { VaultProblems, VaultProblemsOptions } from "./vault-problems";

export class KnowledgeIndex {
  private readonly linkGraph = new LinkGraphIndex();
  private readonly searchIndex = new SearchIndex();
  private readonly bodies = new Map<string, string>();

  setDoc(path: string, content: string): void {
    const projection = projectDoc(path, content);
    this.bodies.set(path, content);
    this.linkGraph.applyDoc(path, projection);
    this.searchIndex.set(path, searchFieldsOf(projection, content));
  }

  setOther(path: string): void {
    if (this.bodies.delete(path)) {
      this.searchIndex.remove(path);
    }
    this.linkGraph.setOther(path);
  }

  remove(path: string): void {
    if (this.bodies.delete(path)) {
      this.searchIndex.remove(path);
    }
    this.linkGraph.remove(path);
  }

  clear(): void {
    this.bodies.clear();
    this.searchIndex.clear();
    this.linkGraph.clear();
  }

  backlinks(path: string): BacklinkEntry[] {
    return this.linkGraph.backlinks(path);
  }

  forwardLinks(path: string): ForwardLinkEntry[] {
    return this.linkGraph.forwardLinks(path);
  }

  problems(options: VaultProblemsOptions): VaultProblems {
    return collectVaultProblems(this.linkGraph, options);
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
      score,
      snippet: this.searchSnippet(path, terms),
      title: this.linkGraph.titleOf(path) ?? docStem(path),
    }));
  }

  // the literal scan beside the ranked search; the sql store answers the same fold over docTexts
  matches(needle: string, options: TextMatchOptions, limit: number): VaultMatches {
    const docs = [...this.bodies].map(([path, body]) => ({
      body,
      path,
      title: this.linkGraph.titleOf(path) ?? docStem(path),
    }));
    return collectVaultMatches(docs, needle, options, limit);
  }

  tags(): TagCount[] {
    return this.linkGraph.tags();
  }

  notesWithTag(tag: string): string[] {
    return this.linkGraph.notesWithTag(tag);
  }

  notesInTagFamily(tag: string): string[] {
    return notesInTagFamily(this.linkGraph, tag);
  }

  relatedNotes(path: string, opts?: RelatedNotesOpts): RelatedNoteEntry[] {
    return relatedNotes(
      this.linkGraph,
      (query, limit, options) => this.searchIndex.search(query, limit, options),
      path,
      opts,
    );
  }

  private searchSnippet(path: string, terms: readonly SearchQueryTerm[]): string {
    const body = this.bodies.get(path);
    if (body === undefined) {
      return "";
    }
    return searchExcerpt(body, terms) || (this.linkGraph.titleOf(path) ?? "");
  }
}
