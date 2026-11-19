import { describe, expect, it } from "vitest";

import { planSearchQuery, stemToken, tokenize } from "./search-query";

const plans = (query: string) =>
  planSearchQuery(query).map((planned) =>
    planned.terms
      .map((term) => (term.prefix ? `${term.token}*` : term.token))
      .join(planned.match === "all" ? " AND " : " OR "),
  );

const plan = (query: string) => plans(query)[0];

describe(tokenize, () => {
  it("lowercases, folds diacritics, and splits on non-word runs", () => {
    expect(tokenize("Hello, Wörld-42!")).toStrictEqual(["hello", "world", "42"]);
    expect(tokenize("Acción Łódź İstanbul")).toStrictEqual(["accion", "łodz", "istanbul"]);
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

describe(planSearchQuery, () => {
  it("has no plan at all for a query with no tokens", () => {
    expect(plans("")).toStrictEqual([]);
    expect(plans("   ")).toStrictEqual([]);
    expect(plans("*^:-()\"'!&|")).toStrictEqual([]);
  });

  it("gives every term the stem a whole-word match asks for, and keeps the typed one's literal token", () => {
    expect(planSearchQuery("interviewing candidates")[0]?.terms).toStrictEqual([
      { prefix: false, stem: "interview", token: "interviewing" },
      { prefix: true, stem: "candid", token: "candidates" },
    ]);
    expect(planSearchQuery("runn")[0]?.terms).toStrictEqual([
      { prefix: true, stem: "runn", token: "runn" },
    ]);
  });

  it("requires every term of a short lookup", () => {
    expect(plan("deploy")).toBe("deploy*");
    expect(plan("deploy runbook")).toBe("deploy AND runbook*");
  });

  it("relaxes a sentence to any term, dropping the function words", () => {
    expect(plan("how do I stop feeling burnt out at work")).toBe(
      "stop OR feeling OR burnt OR work*",
    );
  });

  it("counts content terms, so stopwords cannot tip a lookup into a sentence", () => {
    expect(plan("the deploy of the runbook")).toBe("deploy AND runbook*");
  });

  it("keeps a query that is nothing but stopwords, as a conjunction", () => {
    expect(plans("how do I")).toStrictEqual(["how AND do AND i*"]);
    expect(plans("the")).toStrictEqual(["the*"]);
  });

  it("puts a relaxed plan behind a lookup, and nothing behind a sentence", () => {
    expect(plans("deploy runbook")).toStrictEqual(["deploy AND runbook*", "deploy OR runbook*"]);
    expect(plans("how do I stop feeling burnt out at work")).toHaveLength(1);
    expect(plans("sourdough")).toStrictEqual(["sourdough*"]);
  });

  it("prefix-matches the token still being typed, and only that one", () => {
    expect(plan("burnout wor")).toBe("burnout AND wor*");
    expect(plan("burnout at")).toBe("burnout");
    expect(plan("work at work")).toBe("work*");
  });
});
