import { describe, expect, it } from "vitest";

import { stemToken, tokenize } from "./search-query";

describe(tokenize, () => {
  it("lowercases, folds diacritics, and splits on non-word runs", () => {
    expect(tokenize("Hello, Wörld-42!")).toStrictEqual(["hello", "world", "42"]);
    expect(tokenize("Acción Łódź İstanbul")).toStrictEqual(["accion", "łodz", "istanbul"]);
    // letters of their own, not a letter and a mark
    expect(tokenize("Straße søster 东京")).toStrictEqual(["straße", "søster", "东京"]);
    expect(tokenize("")).toStrictEqual([]);
  });
});

describe(stemToken, () => {
  it("stems a word to the root its other forms share", () => {
    expect(["interviewing", "interviewers", "interview"].map(stemToken)).toStrictEqual([
      "interview",
      "interview",
      "interview",
    ]);
  });

  it("leaves a token it has no rule for as the tokenizer handed it over", () => {
    expect(["bm25", "cafe", "_slug_", "42"].map(stemToken)).toStrictEqual([
      "bm25",
      "cafe",
      "_slug_",
      "42",
    ]);
  });
});
