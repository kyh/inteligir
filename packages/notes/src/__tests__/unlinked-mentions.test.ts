import { describe, expect, it } from "vitest";
import {
  findUnlinkedMentions,
  linkMention,
  mentionNames,
  withheldSpans,
} from "../knowledge/unlinked-mentions";

const target = "Roadmap.md";
const names = mentionNames(target, ["the plan"]);

function mentions(docs: Record<string, string>, limit = 50, exclude: string[] = []) {
  return findUnlinkedMentions(
    Object.entries(docs).map(([path, body]) => ({ path, title: path, body })),
    { names, exclude: new Set([target, ...exclude]), limit },
  );
}

describe("the names a mention can spell", () => {
  it("is the stem and the aliases, deduped by case, never empty", () => {
    expect(mentionNames("notes/Roadmap.md", ["roadmap", " The Plan ", ""])).toEqual([
      "Roadmap",
      "The Plan",
    ]);
  });
});

describe("finding plain mentions", () => {
  it("lists a whole-word mention in any case, with its sentence and count", () => {
    const found = mentions({
      "a.md": "We revisit the roadmap on Monday.\nThe Roadmap again.\n",
      "b.md": "roadmaps are not it\n",
    });
    expect(found.total).toBe(1);
    expect(found.mentions).toEqual([
      expect.objectContaining({
        path: "a.md",
        line: 1,
        column: 15,
        length: 7,
        text: "roadmap",
        before: "We revisit the ",
        after: " on Monday.",
        count: 2,
      }),
    ]);
  });

  it("finds an alias too", () => {
    expect(mentions({ "a.md": "See the plan.\n" }).mentions[0]?.text).toBe("the plan");
  });

  it("skips the target and the docs that already link here", () => {
    const found = mentions(
      { "Roadmap.md": "Roadmap here\n", "linker.md": "Roadmap\n", "c.md": "Roadmap\n" },
      50,
      ["linker.md"],
    );
    expect(found.mentions.map((m) => m.path)).toEqual(["c.md"]);
  });

  it("withholds code, links, urls, frontmatter and comment markers", () => {
    const body = [
      "---",
      "related: Roadmap",
      "---",
      "`Roadmap` in code, [[Roadmap]] linked, [Roadmap](x) md, <https://x/Roadmap> url",
      "https://example.com/Roadmap/next %%i:Roadmap:start%%",
      "```",
      "Roadmap in a fence",
      "```",
      "$Roadmap$ math",
      "",
    ].join("\n");
    expect(mentions({ "a.md": body }).total).toBe(0);
    expect(mentions({ "a.md": `${body}Then the roadmap in prose.\n` }).mentions[0]).toEqual(
      expect.objectContaining({ line: 10, text: "roadmap", count: 1 }),
    );
  });

  it("counts every mentioning doc past the limit", () => {
    const found = mentions({ "a.md": "Roadmap\n", "b.md": "Roadmap\n", "c.md": "Roadmap\n" }, 2);
    expect(found.mentions).toHaveLength(2);
    expect(found.total).toBe(3);
  });

  it("closes an unclosed fence at the end of the doc", () => {
    expect(withheldSpans("x\n```\nRoadmap\n")).toContainEqual({ start: 2, end: 14 });
  });
});

describe("linking a mention", () => {
  it("wraps exactly the shown bytes and nothing else", () => {
    const content = "roadmap first.\r\nWe revisit the roadmap on Monday. roadmap.\n";
    const site = { line: 2, column: 15, length: 7, text: "roadmap" };
    expect(linkMention(content, site, "Roadmap")).toBe(
      "roadmap first.\r\nWe revisit the [[Roadmap|roadmap]] on Monday. roadmap.\n",
    );
  });

  it("spells the bare link when the prose already matches the target", () => {
    const site = { line: 1, column: 4, length: 7, text: "Roadmap" };
    expect(linkMention("See Roadmap.\n", site, "Roadmap")).toBe("See [[Roadmap]].\n");
  });

  it("refuses when the bytes moved", () => {
    const site = { line: 1, column: 4, length: 7, text: "Roadmap" };
    expect(linkMention("See it.\n", site, "Roadmap")).toBeNull();
    expect(linkMention("one\n", { line: 3, column: 0, length: 1, text: "x" }, "x")).toBeNull();
  });
});
