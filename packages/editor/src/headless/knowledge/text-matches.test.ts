import { describe, expect, it } from "vitest";

import { findTextOffsets } from "./text-matches";

const LOOSE = { caseSensitive: false, wholeWord: false };

describe("finding literal occurrences", () => {
  it("folds case the unicode way without moving offsets", () => {
    expect(findTextOffsets("ACCIÓN acción", "acción", LOOSE)).toStrictEqual([
      { length: 6, offset: 0 },
      { length: 6, offset: 7 },
    ]);
  });

  it("honours case-sensitive and whole-word", () => {
    const text = "Deploy deploys deploy_now deploy";
    expect(findTextOffsets(text, "deploy", { caseSensitive: true, wholeWord: false })).toHaveLength(
      3,
    );
    expect(
      findTextOffsets(text, "deploy", { caseSensitive: false, wholeWord: true }),
    ).toStrictEqual([
      { length: 6, offset: 0 },
      { length: 6, offset: 26 },
    ]);
  });

  it("treats regex syntax in the needle as text", () => {
    expect(findTextOffsets("a.b axb", "a.b", LOOSE)).toStrictEqual([{ length: 3, offset: 0 }]);
  });

  it("finds nothing for an empty needle", () => {
    expect(findTextOffsets("anything", "", LOOSE)).toStrictEqual([]);
  });
});

describe("offsets into one string", () => {
  it("keeps the original text's offsets past a letter whose lower case is longer", () => {
    expect(findTextOffsets("İstanbul foo", "FOO", LOOSE)).toStrictEqual([{ length: 3, offset: 9 }]);
  });

  it("counts from the start of the string, across a soft break", () => {
    expect(
      findTextOffsets("cat\nCat", "cat", { caseSensitive: true, wholeWord: true }),
    ).toStrictEqual([{ length: 3, offset: 0 }]);
    expect(findTextOffsets("cat\nCat", "cat", LOOSE)).toStrictEqual([
      { length: 3, offset: 0 },
      { length: 3, offset: 4 },
    ]);
  });
});
