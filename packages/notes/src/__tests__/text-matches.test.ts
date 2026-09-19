import { describe, expect, it } from "vitest";

import {
  bodyPrefilter,
  collectVaultMatches,
  excerptAround,
  findTextMatches,
  replaceTextMatches,
} from "../knowledge/text-matches";

const LOOSE = { caseSensitive: false, wholeWord: false };

describe("finding literal occurrences", () => {
  it("answers line and column per occurrence, across every terminator", () => {
    const text = "Deploy on Friday\r\nnever deploy Friday evening\rredeploy\n";
    expect(findTextMatches(text, "deploy", LOOSE)).toEqual([
      { column: 0, length: 6, line: 1 },
      { column: 6, length: 6, line: 2 },
      { column: 2, length: 6, line: 3 },
    ]);
  });

  it("folds case the unicode way without moving offsets", () => {
    expect(findTextMatches("ACCIÓN acción", "acción", LOOSE)).toEqual([
      { column: 0, length: 6, line: 1 },
      { column: 7, length: 6, line: 1 },
    ]);
  });

  it("honours case-sensitive and whole-word", () => {
    const text = "Deploy deploys deploy_now deploy";
    expect(findTextMatches(text, "deploy", { caseSensitive: true, wholeWord: false })).toHaveLength(
      3,
    );
    expect(findTextMatches(text, "deploy", { caseSensitive: false, wholeWord: true })).toEqual([
      { column: 0, length: 6, line: 1 },
      { column: 26, length: 6, line: 1 },
    ]);
  });

  it("treats regex syntax in the needle as text", () => {
    expect(findTextMatches("a.b axb", "a.b", LOOSE)).toEqual([{ column: 0, length: 3, line: 1 }]);
  });

  it("finds nothing for an empty needle", () => {
    expect(findTextMatches("anything", "", LOOSE)).toEqual([]);
  });
});

describe("replacing what the rows showed", () => {
  it("rewrites every occurrence, keeps terminators and counts", () => {
    const text = "Deploy on Friday\r\nnever deploy\n";
    expect(replaceTextMatches(text, "deploy", "ship", LOOSE)).toEqual({
      count: 2,
      text: "ship on Friday\r\nnever ship\n",
    });
  });

  it("writes a `$1` as text, not a group", () => {
    expect(replaceTextMatches("cost: 5", "5", "$1", LOOSE).text).toBe("cost: $1");
  });
});

describe("the excerpt around a match", () => {
  it("clips both sides and marks the cut", () => {
    const line = `${"a".repeat(60)}NEEDLE${"b".repeat(120)}`;
    const excerpt = excerptAround(line, { column: 60, length: 6, line: 1 });
    expect(excerpt.text).toBe("NEEDLE");
    expect(excerpt.before).toBe(`…${"a".repeat(40)}`);
    expect(excerpt.after).toBe(`${"b".repeat(80)}…`);
  });
});

describe("the prefilter a store may apply", () => {
  it("is the needle for printable ascii and nothing otherwise", () => {
    expect(bodyPrefilter("deploy now")).toBe("deploy now");
    expect(bodyPrefilter("acción")).toBeNull();
    expect(bodyPrefilter("a\tb")).toBeNull();
  });
});

describe("matches across a vault", () => {
  const docs = [
    { body: "x y x\n", path: "b.md", title: "B" },
    { body: "x\nno\nx\n", path: "a.md", title: "A" },
    { body: "nothing here\n", path: "c.md", title: "C" },
  ];

  it("lists in path order with each doc's ordinal, and counts everything past the cap", () => {
    const { matches, total } = collectVaultMatches(docs, "x", LOOSE, 3);
    expect(total).toBe(4);
    expect(matches.map((m) => `${m.path}:${m.line}:${m.column}#${m.ordinal}`)).toEqual([
      "a.md:1:0#0",
      "a.md:3:0#1",
      "b.md:1:0#0",
    ]);
    expect(matches[2]).toMatchObject({ after: " y x", before: "", text: "x", title: "B" });
  });
});
