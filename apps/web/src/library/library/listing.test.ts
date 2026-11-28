import { describe, expect, it } from "vitest";

import { listingQuery, saveTagsOf } from "./listing";

describe("the grid's listing query", () => {
  it("narrows to the chip's kind only when one is pressed", () => {
    const all = { scope: { kind: "all" }, sort: "title", words: null } as const;
    expect(listingQuery({ ...all, kind: "pdf" })).toMatchObject({ kinds: ["pdf"], sort: "title" });
    expect(listingQuery({ ...all, kind: null })).not.toHaveProperty("kinds");
  });

  it("asks the address's words, and none without them", () => {
    const all = { kind: null, scope: { kind: "all" }, sort: "title" } as const;
    expect(listingQuery({ ...all, words: "tidal" })).toMatchObject({ words: "tidal" });
    expect(listingQuery({ ...all, words: null })).not.toHaveProperty("words");
  });
});

describe("a scope", () => {
  it("tags a save from it", () => {
    expect(saveTagsOf({ kind: "tag", tag: "papers" })).toStrictEqual(["papers"]);
  });
});
