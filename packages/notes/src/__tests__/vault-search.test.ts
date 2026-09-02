import { describe, expect, it } from "vitest";

import type { SearchResult } from "../knowledge/knowledge-index";
import { parseSearchQuery, searchVaultNotes } from "../knowledge/vault-search";

function hit(path: string, score: number): SearchResult {
  return { path, score, snippet: `…${path}…`, title: path.replace(/\.md$/, "") };
}

const RANKED = [hit("a.md", 3), hit("b.md", 2), hit("c.md", 1)];

const sources = {
  notesWithTag: (tag: string) => (tag === "work" ? ["c.md", "a.md"] : []),
  search: (query: string, limit: number) =>
    (query === "note" ? RANKED : []).slice(0, limit) satisfies SearchResult[],
};

describe("searchVaultNotes", () => {
  it("plain text search passes straight through, ranking intact", () => {
    expect(searchVaultNotes(sources, { limit: 10, query: "note" })).toEqual(RANKED);
  });

  it("no text and no tag is not a search for everything", () => {
    expect(searchVaultNotes(sources, { limit: 10, query: "   " })).toEqual([]);
    expect(searchVaultNotes(sources, { limit: 10, query: "", tag: "  " })).toEqual([]);
  });

  it("tag alone lists that tag's notes, sorted and capped", () => {
    expect(searchVaultNotes(sources, { limit: 10, query: "", tag: "work" })).toEqual([
      { path: "a.md", score: 0, snippet: "", title: "a" },
      { path: "c.md", score: 0, snippet: "", title: "c" },
    ]);
    expect(searchVaultNotes(sources, { limit: 1, query: "", tag: "work" })).toHaveLength(1);
  });

  it("tag narrows the set, text ranks within it", () => {
    expect(searchVaultNotes(sources, { limit: 10, query: "note", tag: "work" })).toEqual([
      hit("a.md", 3),
      hit("c.md", 1),
    ]);
  });

  it("asks the index for a WIDER window than the limit before filtering", () => {
    const limits: number[] = [];
    const narrow = {
      notesWithTag: () => ["c.md"],
      search: (_query: string, limit: number) => {
        limits.push(limit);
        return RANKED.slice(0, limit);
      },
    };
    expect(searchVaultNotes(narrow, { limit: 1, query: "note", tag: "work" })).toEqual([
      hit("c.md", 1),
    ]);
    expect(limits).toEqual([10]);
  });

  it("an unknown tag matches nothing, whatever the text says", () => {
    expect(searchVaultNotes(sources, { limit: 10, query: "note", tag: "nope" })).toEqual([]);
  });
});

describe("parseSearchQuery", () => {
  it("splits a tag: term out of the text, wherever it sits", () => {
    expect(parseSearchQuery("tag:work standup notes")).toEqual({
      query: "standup notes",
      tag: "work",
    });
    expect(parseSearchQuery("standup tag:work notes")).toEqual({
      query: "standup notes",
      tag: "work",
    });
  });

  it("plain text carries no tag", () => {
    expect(parseSearchQuery("  standup  notes ")).toEqual({ query: "standup notes", tag: "" });
  });

  it("a bare tag: filters nothing and never reaches the text", () => {
    expect(parseSearchQuery("tag: standup")).toEqual({ query: "standup", tag: "" });
  });

  it("takes the first tag and swallows the rest — never leaks one into the text", () => {
    expect(parseSearchQuery("tag:work tag:home")).toEqual({ query: "", tag: "work" });
  });
});
