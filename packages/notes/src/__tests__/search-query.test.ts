// The query policy both engines execute. What is pinned here is the shape of
// the plan; that FTS5 and the pure index AGREE on it is pinned where both can
// be run together (apps/cli/src/server/knowledge/__tests__/search-eval.test.ts).

import { describe, expect, it } from "vitest";

import { planSearchQuery, stemText, tokenize } from "../knowledge/search-query";

/** The plans as readable strings — `a AND b*`, `a OR b` — in run order. */
function plans(query: string): string[] {
  return planSearchQuery(query).map((planned) =>
    planned.terms
      .map((term) => (term.prefix ? `${term.token}*` : term.token))
      .join(planned.match === "all" ? " AND " : " OR "),
  );
}

/** The first plan, which is what a query that matches anything at all runs. */
function plan(query: string): string | undefined {
  return plans(query)[0];
}

describe("tokenize", () => {
  it("lowercases, folds diacritics, and splits on non-word runs", () => {
    // The fold is what keeps this tokenizer and FTS5's unicode61 answering the
    // same question; the store pins the two against each other.
    expect(tokenize("Hello, Wörld-42!")).toEqual(["hello", "world", "42"]);
    expect(tokenize("Acción Łódź İstanbul")).toEqual(["accion", "łodz", "istanbul"]);
    // Letters unicode61 does not fold either are left exactly alone.
    expect(tokenize("Straße søster 东京")).toEqual(["straße", "søster", "东京"]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("stemming", () => {
  it("stems the text an engine indexes, token for token and in order", () => {
    // Order and repetition survive, so a stemmed field has the same length and
    // term frequencies as the literal field it shadows.
    expect(stemText("Two interviewers per loop, two loops")).toBe(
      "two interview per loop two loop",
    );
    expect(stemText("")).toBe("");
  });

  it("leaves a token it has no rule for as the tokenizer handed it over", () => {
    // Identifiers and other languages carry no English suffix, so the stemmer
    // returns them unchanged — folded, because stemming runs over tokens and
    // the fold is part of tokenizing.
    expect(stemText("bm25 café _slug_ 42")).toBe("bm25 cafe _slug_ 42");
  });

  it("gives every term the stem a whole-word match asks for", () => {
    expect(planSearchQuery("interviewing candidates")[0]?.terms).toEqual([
      { token: "interviewing", stem: "interview", prefix: false },
      { token: "candidates", stem: "candid", prefix: true },
    ]);
  });

  it("keeps the typed term's literal token, which is what prefix-matches", () => {
    // Mid-word the stem is the fragment itself and buys nothing; the literal
    // token is the half that still finds `running` from `runn`.
    expect(planSearchQuery("runn")[0]?.terms).toEqual([
      { token: "runn", stem: "runn", prefix: true },
    ]);
  });
});

describe("planSearchQuery", () => {
  it("has no plan at all for a query with no tokens", () => {
    expect(plans("")).toEqual([]);
    expect(plans("   ")).toEqual([]);
    // Every FTS5 metacharacter at once still tokenizes to nothing.
    expect(plans('*^:-()"')).toEqual([]);
  });

  it("requires every term of a short lookup", () => {
    expect(plan("deploy")).toBe("deploy*");
    expect(plan("deploy runbook")).toBe("deploy AND runbook*");
  });

  it("relaxes a sentence to any term, dropping the function words", () => {
    // The headline bug: this asked for a note carrying `how`, `do` and `at`.
    expect(plan("how do I stop feeling burnt out at work")).toBe(
      "stop OR feeling OR burnt OR work*",
    );
  });

  it("counts CONTENT terms, so stopwords cannot tip a lookup into a sentence", () => {
    expect(plan("the deploy of the runbook")).toBe("deploy AND runbook*");
  });

  it("keeps a query that is nothing but stopwords, as a conjunction", () => {
    // The floor: dropping all of them leaves an empty match expression, which
    // FTS5 reads as every note in the vault. AND over the literal words is
    // both narrow and exactly what this query did before — and it carries NO
    // relaxed plan behind it, because relaxing it IS the whole vault.
    expect(plans("how do I")).toEqual(["how AND do AND i*"]);
    expect(plans("the")).toEqual(["the*"]);
  });

  it("puts a relaxed plan behind a lookup, and nothing behind a sentence", () => {
    expect(plans("deploy runbook")).toEqual(["deploy AND runbook*", "deploy OR runbook*"]);
    // A sentence is already relaxed, and one term asks the same thing either
    // way — a second plan there would only re-run the one that just failed.
    expect(plans("how do I stop feeling burnt out at work")).toHaveLength(1);
    expect(plans("sourdough")).toEqual(["sourdough*"]);
  });

  it("prefix-matches the token still being typed, and only that one", () => {
    expect(plan("burnout wor")).toBe("burnout AND wor*");
    // A stopword trailing it means the word before is finished.
    expect(plan("burnout at")).toBe("burnout");
    // Repeats collapse, and the prefix follows the token, not its position.
    expect(plan("work at work")).toBe("work*");
  });

  it("plans FTS5 operator words as ordinary terms", () => {
    // `and`/`or`/`not` are stopwords, so what is left is the one word that is
    // also an operator — and it must reach the engine as a term.
    expect(plan("near miss")).toBe("near AND miss*");
  });
});
