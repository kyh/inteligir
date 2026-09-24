import { describe, expect, it } from "vitest";

import {
  isUuidWikiAlias,
  parseWikiBody,
  parseWikiBodyRange,
  serializeWikiBody,
} from "../remark-wiki-link";

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
    // the range maps the raw slice, escapes included, which is what a rename rewrites
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

describe("serializeWikiBody", () => {
  it("writes the plain spelling when it parses back", () => {
    expect(serializeWikiBody({ target: "note" })).toBe("note");
    expect(serializeWikiBody({ anchor: "sec", target: "note" })).toBe("note#sec");
    expect(serializeWikiBody({ alias: "nice", target: "note" })).toBe("note|nice");
    expect(serializeWikiBody({ alias: "nice", anchor: "sec", target: "note" })).toBe(
      "note#sec|nice",
    );
    expect(serializeWikiBody({ target: "C# Notes" })).toBe("C# Notes");
    expect(serializeWikiBody({ alias: "", anchor: "", target: "note" })).toBe("note");
  });

  it("escapes every `\\` and `#` when the plain spelling would split", () => {
    expect(serializeWikiBody({ target: "Issue#42" })).toBe("Issue\\#42");
    expect(serializeWikiBody({ target: "#hash" })).toBe("\\#hash");
    expect(serializeWikiBody({ anchor: "sec", target: "C#" })).toBe("C\\##sec");
    expect(serializeWikiBody({ target: "a\\#b" })).toBe("a\\\\\\#b");
  });

  it("answers null when no spelling survives the parse", () => {
    for (const parts of [
      { target: "[draft]" },
      { target: "a]b" },
      { target: "two\nlines" },
      { target: "a|b" },
      { alias: "x|y", target: "note" },
      { target: " padded" },
      { target: "" },
    ]) {
      expect(serializeWikiBody(parts), JSON.stringify(parts)).toBeNull();
    }
    expect(serializeWikiBody({ alias: "shown", target: "a|b" })).toBe("a|b|shown");
  });

  it("is parseWikiBody's inverse over every part it can carry", () => {
    const targets = ["Plan", "C# Notes", "Issue#42", "#lead", "tail#", "a\\b", "x/y.txt", "100%"];
    const anchors = [undefined, "sec", "a#b", "C#"];
    const aliases = [undefined, "shown", "Issue#42"];
    for (const target of targets) {
      for (const anchor of anchors) {
        for (const alias of aliases) {
          const body = serializeWikiBody({ alias, anchor, target });
          const label = JSON.stringify({ alias, anchor, target });
          expect(body, label).not.toBeNull();
          const parsed = parseWikiBody(body ?? "");
          expect([parsed.target, parsed.anchor, parsed.alias], label).toEqual([
            target,
            anchor,
            alias,
          ]);
        }
      }
    }
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
