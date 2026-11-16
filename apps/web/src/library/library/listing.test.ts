import { describe, expect, it } from "vitest";

import { listingQuery, saveTagsOf } from "./listing";

describe("the grid's listing query", () => {
  it("narrows to the chip's kind only when one is pressed", () => {
    expect(listingQuery({ kind: "pdf", scope: { kind: "all" }, sort: "title" })).toMatchObject({
      kinds: ["pdf"],
      sort: "title",
    });
    expect(listingQuery({ kind: null, scope: { kind: "all" }, sort: "title" })).not.toHaveProperty(
      "kinds",
    );
  });
});

describe("a scope", () => {
  it("tags a save from it", () => {
    expect(saveTagsOf({ kind: "tag", tag: "papers" })).toStrictEqual(["papers"]);
  });
});
