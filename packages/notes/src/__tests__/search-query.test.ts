import { describe, expect, it } from "vitest";

import { planSearchQuery, stemText, tokenize } from "../knowledge/search-query";

// `a AND b*`: the `*` marks the prefix term
function plans(query: string): string[] {
  return planSearchQuery(query).map((planned) =>
    planned.terms
      .map((term) => (term.prefix ? `${term.token}*` : term.token))
      .join(planned.match === "all" ? " AND " : " OR "),
  );
}

function plan(query: string): string | undefined {
  return plans(query)[0];
}

describe("tokenize", () => {
  it("lowercases, folds diacritics, and splits on non-word runs", () => {
    expect(tokenize("Hello, Wörld-42!")).toEqual(["hello", "world", "42"]);
    expect(tokenize("Acción Łódź İstanbul")).toEqual(["accion", "łodz", "istanbul"]);
    // unicode61 does not fold these either
    expect(tokenize("Straße søster 东京")).toEqual(["straße", "søster", "东京"]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("stemming", () => {
  it("stems the text an engine indexes, token for token and in order", () => {
    expect(stemText("Two interviewers per loop, two loops")).toBe(
      "two interview per loop two loop",
    );
    expect(stemText("")).toBe("");
  });

  it("leaves a token it has no rule for as the tokenizer handed it over", () => {
    expect(stemText("bm25 café _slug_ 42")).toBe("bm25 cafe _slug_ 42");
  });

  it("gives every term the stem a whole-word match asks for", () => {
    expect(planSearchQuery("interviewing candidates")[0]?.terms).toEqual([
      { token: "interviewing", stem: "interview", prefix: false },
      { token: "candidates", stem: "candid", prefix: true },
    ]);
  });

  it("keeps the typed term's literal token, which is what prefix-matches", () => {
    expect(planSearchQuery("runn")[0]?.terms).toEqual([
      { token: "runn", stem: "runn", prefix: true },
    ]);
  });
});

describe("planSearchQuery", () => {
  it("has no plan at all for a query with no tokens", () => {
    expect(plans("")).toEqual([]);
    expect(plans("   ")).toEqual([]);
    // every FTS5 metacharacter
    expect(plans('*^:-()"')).toEqual([]);
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

  it("counts CONTENT terms, so stopwords cannot tip a lookup into a sentence", () => {
    expect(plan("the deploy of the runbook")).toBe("deploy AND runbook*");
  });

  it("keeps a query that is nothing but stopwords, as a conjunction", () => {
    expect(plans("how do I")).toEqual(["how AND do AND i*"]);
    expect(plans("the")).toEqual(["the*"]);
  });

  it("puts a relaxed plan behind a lookup, and nothing behind a sentence", () => {
    expect(plans("deploy runbook")).toEqual(["deploy AND runbook*", "deploy OR runbook*"]);
    expect(plans("how do I stop feeling burnt out at work")).toHaveLength(1);
    expect(plans("sourdough")).toEqual(["sourdough*"]);
  });

  it("prefix-matches the token still being typed, and only that one", () => {
    expect(plan("burnout wor")).toBe("burnout AND wor*");
    // a trailing stopword means the word before it is finished
    expect(plan("burnout at")).toBe("burnout");
    // repeats collapse; the prefix follows the token, not its position
    expect(plan("work at work")).toBe("work*");
  });

  it("plans FTS5 operator words as ordinary terms", () => {
    // `near` is an FTS5 operator; `and`/`or`/`not` are stopwords already
    expect(plan("near miss")).toBe("near AND miss*");
  });
});
