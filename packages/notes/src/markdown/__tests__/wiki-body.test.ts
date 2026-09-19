import { describe, expect, it } from "vitest";

import { isUuidWikiAlias, parseWikiBodyRange } from "../remark-wiki-link";

describe("parseWikiBodyRange — escapes and tight-# anchors", () => {
  it("splits a tight # into the anchor", () => {
    expect(parseWikiBodyRange("Note#Heading")).toEqual({
      anchor: "Heading",
      target: "Note",
      targetRange: { end: 4, start: 0 },
    });
  });

  it("a space-surrounded # is title text", () => {
    expect(parseWikiBodyRange("A # B")).toEqual({
      target: "A # B",
      targetRange: { end: 5, start: 0 },
    });
  });

  it("a one-sided # is title text (C# Notes)", () => {
    expect(parseWikiBodyRange("C# Notes")).toEqual({
      target: "C# Notes",
      targetRange: { end: 8, start: 0 },
    });
  });

  it("position 0 is an anchor regardless (pure-anchor link)", () => {
    expect(parseWikiBodyRange("#sec")).toEqual({ anchor: "sec", target: "" });
  });

  it("an escaped # stays in the title, unescaped for resolution", () => {
    const parsed = parseWikiBodyRange("My \\#1 Note");
    expect(parsed.target).toBe("My #1 Note");
    expect(parsed.anchor).toBeUndefined();
    // The range maps the RAW slice; verification fails closed on escaped
    // titles, so rename surgery never rewrites them.
    expect(parsed.targetRange).toEqual({ end: 11, start: 0 });
  });

  it("an escaped backslash unescapes", () => {
    expect(parseWikiBodyRange("Note\\\\").target).toBe("Note\\");
  });

  it("a trailing # is title text (nothing tight after it)", () => {
    expect(parseWikiBodyRange("a#").target).toBe("a#");
  });

  it("alias still splits at the last pipe", () => {
    expect(parseWikiBodyRange("A|B|c").target).toBe("A|B");
    expect(parseWikiBodyRange("A|B|c").alias).toBe("c");
  });
});

describe("isUuidWikiAlias", () => {
  it("matches the resolved-link uuid, either case", () => {
    expect(isUuidWikiAlias("9e64c3df-c1e2-4a4d-8c07-91528f422413")).toBe(true);
    expect(isUuidWikiAlias("9E64C3DF-C1E2-4A4D-8C07-91528F422413")).toBe(true);
  });

  it("rejects display text and near-misses", () => {
    expect(isUuidWikiAlias("friendly name")).toBe(false);
    expect(isUuidWikiAlias("9e64c3df-c1e2-4a4d-8c07")).toBe(false);
    expect(isUuidWikiAlias("")).toBe(false);
  });
});
