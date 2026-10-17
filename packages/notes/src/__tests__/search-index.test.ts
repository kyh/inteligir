import { describe, expect, it } from "vitest";

import { SearchIndex } from "../knowledge/search-index";

const paths = (index: SearchIndex, query: string): string[] =>
  index.search(query, 20).map((hit) => hit.path);

const seeded = (): SearchIndex => {
  const index = new SearchIndex();
  index.set("title.md", { body: "nothing else", headings: [], meta: "", title: "alpha" });
  index.set("heading.md", { body: "nothing else", headings: ["alpha"], meta: "", title: "other" });
  index.set("body.md", { body: "alpha appears here", headings: [], meta: "", title: "other" });
  return index;
};

describe("SearchIndex — ranking", () => {
  it("tiers title > heading > body", () => {
    expect(paths(seeded(), "alpha")).toEqual(["title.md", "heading.md", "body.md"]);
  });

  it("caps term frequency so body spam cannot beat a title match", () => {
    const index = seeded();
    index.set("body.md", { body: "alpha ".repeat(100), headings: [], meta: "", title: "other" });
    expect(paths(index, "alpha")[0]).toBe("title.md");
  });

  it("ANDs a short query, and relaxes it only once it has found nothing", () => {
    const index = new SearchIndex();
    index.set("both.md", { body: "", headings: [], meta: "", title: "alpha beta" });
    index.set("one.md", { body: "", headings: [], meta: "", title: "alpha" });
    expect(paths(index, "alpha beta")).toEqual(["both.md"]);
    expect(paths(index, "alpha gamma")).toEqual(["both.md", "one.md"]);
  });

  it("ORs a sentence, ranking a doc matching more terms above one matching fewer", () => {
    const index = new SearchIndex();
    index.set("three.md", { body: "", headings: [], meta: "", title: "alpha beta gamma" });
    index.set("two.md", { body: "", headings: [], meta: "", title: "alpha beta" });
    index.set("one.md", { body: "", headings: [], meta: "", title: "gamma" });
    index.set("none.md", { body: "", headings: [], meta: "", title: "delta" });
    expect(paths(index, "alpha beta gamma")).toEqual(["three.md", "two.md", "one.md"]);
  });

  it("drops the function words a sentence is mostly made of", () => {
    const index = new SearchIndex();
    index.set("burnout.md", {
      body: "I have been exhausted lately and cannot focus on anything at work.",
      headings: [],
      meta: "",
      title: "Burnout",
    });
    expect(paths(index, "how do I stop feeling burnt out at work")).toEqual(["burnout.md"]);
  });

  it("answers an all-stopword query with the notes carrying those words", () => {
    const index = new SearchIndex();
    index.set("phrase.md", { body: "", headings: [], meta: "", title: "how do I" });
    index.set("other.md", { body: "", headings: [], meta: "", title: "how" });
    expect(paths(index, "how do I")).toEqual(["phrase.md"]);
  });

  it("prefix-matches the final token, below an exact match", () => {
    const index = new SearchIndex();
    index.set("exact.md", { body: "", headings: [], meta: "", title: "alp" });
    index.set("prefix.md", { body: "", headings: [], meta: "", title: "alpha" });
    expect(paths(index, "alp")).toEqual(["exact.md", "prefix.md"]);
    expect(paths(index, "alph nothing")).toEqual([]);
  });

  it("returns [] for an empty query and respects the limit", () => {
    const index = seeded();
    expect(index.search("", 10)).toEqual([]);
    expect(index.search("alpha", 2)).toHaveLength(2);
  });
});

const hiring = (): SearchIndex => {
  const index = new SearchIndex();
  index.set("hiring.md", {
    body: "Two interviewers per loop, written feedback within a day.",
    headings: [],
    meta: "",
    title: "Hiring",
  });
  return index;
};

describe("SearchIndex — stemming", () => {
  it("reaches a word the note inflects differently", () => {
    // no prefix of either word reaches the other; only the stem does
    expect(paths(hiring(), "interviewing candidates")).toEqual(["hiring.md"]);
  });

  it("stems the token still being typed too, so one word is a whole query", () => {
    expect(paths(hiring(), "interviewer")).toEqual(["hiring.md"]);
  });

  it("still prefix-matches a genuine fragment, which no stem can", () => {
    expect(paths(hiring(), "interv")).toEqual(["hiring.md"]);
  });

  it("does not let a stem match outrank the exact word", () => {
    const index = new SearchIndex();
    index.set("exact.md", { body: "", headings: [], meta: "", title: "loop" });
    index.set("inflected.md", { body: "", headings: [], meta: "", title: "looping" });
    expect(paths(index, "loop")).toEqual(["exact.md", "inflected.md"]);
  });
});

describe("SearchIndex — incremental updates", () => {
  it("re-indexes a doc in place", () => {
    const index = new SearchIndex();
    index.set("a.md", { body: "", headings: [], meta: "", title: "old words" });
    index.set("a.md", { body: "", headings: [], meta: "", title: "new words" });
    expect(paths(index, "old")).toEqual([]);
    expect(paths(index, "new")).toEqual(["a.md"]);
  });

  it("removes a doc's postings, stems included", () => {
    const index = new SearchIndex();
    index.set("a.md", { body: "", headings: [], meta: "", title: "findable interviewers" });
    index.remove("a.md");
    expect(paths(index, "findable")).toEqual([]);
    expect(paths(index, "interviewing candidates")).toEqual([]);
  });
});

describe("SearchIndex — the meta field", () => {
  it("ranks a meta hit between a heading and the body", () => {
    const index = new SearchIndex();
    index.set("heading.md", { body: "", headings: ["quokka"], meta: "", title: "a" });
    index.set("meta.md", { body: "", headings: [], meta: "quokka.com quokka", title: "b" });
    index.set("body.md", { body: "quokka", headings: [], meta: "", title: "c" });
    expect(paths(index, "quokka")).toEqual(["heading.md", "meta.md", "body.md"]);
  });
});
