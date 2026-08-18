import { describe, expect, it } from "vitest";

import { SearchIndex } from "../knowledge/search-index";

function paths(index: SearchIndex, query: string): string[] {
  return index.search(query, 20).map((hit) => hit.path);
}

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

  it("ANDs a short query, and relaxes it only once it has found nothing", () => {
    const index = new SearchIndex();
    index.set("both.md", { title: "alpha beta", headings: [], body: "" });
    index.set("one.md", { title: "alpha", headings: [], body: "" });
    // `beta` narrows, because the conjunction had an answer …
    expect(paths(index, "alpha beta")).toEqual(["both.md"]);
    // … and `gamma` cannot, because requiring it answers with nothing.
    expect(paths(index, "alpha gamma")).toEqual(["both.md", "one.md"]);
  });

  it("ORs a sentence, ranking a doc matching more terms above one matching fewer", () => {
    const index = new SearchIndex();
    index.set("three.md", { title: "alpha beta gamma", headings: [], body: "" });
    index.set("two.md", { title: "alpha beta", headings: [], body: "" });
    index.set("one.md", { title: "gamma", headings: [], body: "" });
    index.set("none.md", { title: "delta", headings: [], body: "" });
    expect(paths(index, "alpha beta gamma")).toEqual(["three.md", "two.md", "one.md"]);
  });

  it("drops the function words a sentence is mostly made of", () => {
    const index = new SearchIndex();
    index.set("burnout.md", {
      title: "Burnout",
      headings: [],
      body: "I have been exhausted lately and cannot focus on anything at work.",
    });
    // Every token was required before, `how` and `do` included, so this whole
    // class of query answered with nothing at all.
    expect(paths(index, "how do I stop feeling burnt out at work")).toEqual(["burnout.md"]);
  });

  it("answers an all-stopword query with the notes carrying those words", () => {
    const index = new SearchIndex();
    index.set("phrase.md", { title: "how do I", headings: [], body: "" });
    index.set("other.md", { title: "how", headings: [], body: "" });
    // Not the whole index, and not nothing: the conjunction still holds.
    expect(paths(index, "how do I")).toEqual(["phrase.md"]);
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
