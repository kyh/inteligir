import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";

import { parseMdast } from "../parse";

const dates = (md: string): string[] => {
  const found: string[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "date") {
      found.push(node.value);
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(parseMdast(md).root);
  return found;
};

describe("a date chip is `@` and a calendar date", () => {
  it("reads at a line's edges, beside punctuation and in a list", () => {
    expect(dates("@2026-07-01 kickoff, ends @2026-12-31.\n\n- meet (@2026-07-02)\n")).toEqual([
      "2026-07-01",
      "2026-12-31",
      "2026-07-02",
    ]);
  });

  it("reads glued to a word on either side, where the editor can put one", () => {
    expect(dates("x@2026-07-01y and @2026-07-02@2026-07-03\n")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  it.each([
    ["a day no calendar has", "due @2026-02-30\n"],
    ["a date a digit runs on from", "at @2026-07-012\n"],
    ["a date inside code", "`@2026-07-01`\n"],
    [
      "a date in a link's text, whose url it would part",
      "see https://example.com/?d=@2026-07-01\n",
    ],
    ["an email's domain", "mail x@2026-07-01.example.com\n"],
  ])("is not %s", (_name, md) => {
    expect(dates(md)).toEqual([]);
  });
});
