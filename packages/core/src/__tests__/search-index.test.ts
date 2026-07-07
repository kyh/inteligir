import { describe, expect, it } from "vitest";

import { SearchIndex, tokenize } from "../knowledge/search-index";

function paths(index: SearchIndex, query: string): string[] {
  return index.search(query, 20).map((hit) => hit.path);
}

describe("tokenize", () => {
  it("lowercases and splits on non-word runs, unicode included", () => {
    expect(tokenize("Hello, Wörld-42!")).toEqual(["hello", "wörld", "42"]);
    expect(tokenize("")).toEqual([]);
  });
});

function seeded(): SearchIndex {
  const index = new SearchIndex();
  index.set("title.md", { title: "alpha", headings: [], body: "nothing else" });
  index.set("heading.md", { title: "other", headings: ["alpha"], body: "nothing else" });
  index.set("body.md", { title: "other", headings: [], body: "alpha appears here" });
  return index;
}

describe("SearchIndex — ranking", () => {
  it("tiers title > heading > body", () => {
    expect(paths(seeded(), "alpha")).toEqual(["title.md", "heading.md", "body.md"]);
  });

  it("caps term frequency so body spam cannot beat a title match", () => {
    const index = seeded();
    index.set("body.md", { title: "other", headings: [], body: "alpha ".repeat(100) });
    expect(paths(index, "alpha")[0]).toBe("title.md");
  });

  it("ANDs across query tokens", () => {
    const index = new SearchIndex();
    index.set("both.md", { title: "alpha beta", headings: [], body: "" });
    index.set("one.md", { title: "alpha", headings: [], body: "" });
    expect(paths(index, "alpha beta")).toEqual(["both.md"]);
    expect(paths(index, "alpha gamma")).toEqual([]);
  });

  it("prefix-matches the final token, below an exact match", () => {
    const index = new SearchIndex();
    index.set("exact.md", { title: "alp", headings: [], body: "" });
    index.set("prefix.md", { title: "alpha", headings: [], body: "" });
    expect(paths(index, "alp")).toEqual(["exact.md", "prefix.md"]);
    // Non-final tokens never prefix-match.
    expect(paths(index, "alph nothing")).toEqual([]);
  });

  it("returns [] for an empty query and respects the limit", () => {
    const index = seeded();
    expect(index.search("", 10)).toEqual([]);
    expect(index.search("alpha", 2)).toHaveLength(2);
  });
});

describe("SearchIndex — incremental updates", () => {
  it("re-indexes a doc in place", () => {
    const index = new SearchIndex();
    index.set("a.md", { title: "old words", headings: [], body: "" });
    index.set("a.md", { title: "new words", headings: [], body: "" });
    expect(paths(index, "old")).toEqual([]);
    expect(paths(index, "new")).toEqual(["a.md"]);
  });

  it("removes a doc's postings", () => {
    const index = new SearchIndex();
    index.set("a.md", { title: "findable", headings: [], body: "" });
    index.remove("a.md");
    expect(paths(index, "findable")).toEqual([]);
  });
});
