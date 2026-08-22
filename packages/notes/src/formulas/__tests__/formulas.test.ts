import { describe, expect, it } from "vitest";

import { collectFormulas, formulasById, noteIdOf } from "../collect-formulas";
import { evaluateExpression, parseExpression } from "../expression";
import { formatResult } from "../format-result";
import { parseFormulaMeta, serializeFormulaMeta } from "../formula-meta";
import { resolveExpression } from "../resolve-graph";

const noRefs = (): null => null;

function evaluate(source: string): number | null {
  const tree = parseExpression(source);
  if (tree === null) return null;
  const outcome = evaluateExpression(tree, noRefs);
  return outcome.ok ? outcome.value : null;
}

describe("the executable grammar (the skill's own examples)", () => {
  it("computes the spec's arithmetic", () => {
    expect(evaluate("2+2")).toBe(4);
    expect(evaluate("1000*12")).toBe(12_000);
    expect(evaluate("28")).toBe(28);
  });

  it("honors precedence and parentheses", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("10-2-3")).toBe(5);
    expect(evaluate("12/4/3")).toBe(1);
  });

  it("parses $, thousands commas, %, and k/m/b suffixes", () => {
    expect(evaluate("$5,000")).toBe(5000);
    expect(evaluate("1,234.5")).toBe(1234.5);
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("2k")).toBe(2000);
    expect(evaluate("1.5m")).toBe(1_500_000);
    expect(evaluate("2b")).toBe(2_000_000_000);
  });

  it("accepts Moss's uppercase suffixes and suffix-percent composition", () => {
    expect(evaluate("5K")).toBe(5000);
    expect(evaluate("1.5M")).toBe(1_500_000);
    expect(evaluate("5k%")).toBe(50);
  });

  it("allows unary minus as a factor", () => {
    expect(evaluate("-5+8")).toBe(3);
    expect(evaluate("2*-3")).toBe(-6);
  });

  it("refuses what the grammar excludes — those pills are symbolic", () => {
    expect(parseExpression("9am")).toBeNull();
    expect(parseExpression("9am-930am")).toBeNull();
    expect(parseExpression("sum(1,2)")).toBeNull();
    expect(parseExpression("2^3")).toBeNull();
    expect(parseExpression("1,23")).toBeNull(); // malformed thousands group
    expect(parseExpression("")).toBeNull();
    expect(parseExpression("time")).toBeNull();
  });

  it("answers not-finite for a division by zero instead of a display", () => {
    const tree = parseExpression("1/0");
    expect(tree).not.toBeNull();
    if (tree === null) return;
    expect(evaluateExpression(tree, noRefs)).toEqual({ ok: false, reason: "not-finite" });
  });
});

describe("result formatting", () => {
  it("uses thousands separators and at most two decimals, undecorated", () => {
    expect(formatResult(12_000)).toBe("12,000");
    expect(formatResult(4)).toBe("4");
    expect(formatResult(1 / 3)).toBe("0.33");
    expect(formatResult(5000)).toBe("5,000");
    expect(formatResult(-0)).toBe("0");
  });
});

describe("metadata", () => {
  it("round-trips id/name/stale in one spelling", () => {
    const meta = parseFormulaMeta("id=abc;name=budget;stale=1");
    expect(meta).toEqual({ id: "abc", name: "budget", stale: true, unknown: [] });
    expect(serializeFormulaMeta(meta)).toBe("id=abc;name=budget;stale=1");
    // Moss writes both spellings; `1` is the one we emit.
    expect(parseFormulaMeta("stale=true").stale).toBe(true);
  });

  it("drops legacy format= on rewrite and keeps unknown keys", () => {
    const meta = parseFormulaMeta("id=abc;format=usd;x=1");
    expect(serializeFormulaMeta(meta)).toBe("id=abc;x=1");
  });

  it("serializes nothing for an anonymous pill", () => {
    expect(serializeFormulaMeta(parseFormulaMeta(undefined))).toBeUndefined();
  });
});

describe("collection", () => {
  it("collects pills with their kinds and skips fenced literals", () => {
    const md = [
      "---",
      "id: 9e64c3df-c1e2-4a4d-8c07-91528f422413",
      "---",
      "",
      "A one-off {{2+2|4}} and a symbolic {{time|9am|id=t1}}.",
      "",
      "```",
      "{{3+3|6}} literal",
      "```",
      "",
    ].join("\n");
    expect(noteIdOf(md)).toBe("9e64c3df-c1e2-4a4d-8c07-91528f422413");
    const formulas = collectFormulas(md);
    expect(formulas).toHaveLength(2);
    expect(formulas[0]?.expression).not.toBeNull();
    expect(formulas[1]?.expression).toBeNull();
    expect(formulas[1]?.meta.id).toBe("t1");
  });

  it("first instance wins for linked ids", () => {
    const formulas = collectFormulas("{{1|1|id=a;name=x}} and {{2|2|id=a;name=x}}\n");
    expect(formulasById(formulas).get("a")?.source).toBe("1");
  });
});

describe("the graph (the skill's own type-scale example)", () => {
  const NOTE = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
  const doc = [
    `{{28|28|id=b371c6db-70db-48f1-99e2-9ea1ef6f1151;name=h1_size}}`,
    `{{@(h1_size#${NOTE}#b371c6db-70db-48f1-99e2-9ea1ef6f1151)-6|22|id=c520e764-a784-48c5-81ca-f93ac6f4ad37;name=h2_size}}`,
  ].join("\n\n");

  it("resolves a bound reference through the same note", () => {
    const formulas = collectFormulas(`${doc}\n`);
    const bound = formulas[1];
    expect(bound?.expression).not.toBeNull();
    if (bound?.expression == null) return;
    const outcome = resolveExpression(
      bound.expression,
      { notes: new Map([[NOTE, formulas]]) },
      NOTE,
      formulas,
    );
    expect(outcome).toEqual({ ok: true, value: 22 });
  });

  it("answers cyclic for a reference loop", () => {
    const cyclic = collectFormulas(
      [`{{@(b#${NOTE}#idb)+1|0|id=ida;name=a}}`, `{{@(a#${NOTE}#ida)+1|0|id=idb;name=b}}`, ""].join(
        "\n",
      ),
    );
    const first = cyclic[0];
    if (first?.expression == null) throw new Error("expected an executable pill");
    const outcome = resolveExpression(
      first.expression,
      { notes: new Map([[NOTE, cyclic]]) },
      NOTE,
      cyclic,
    );
    expect(outcome).toEqual({ ok: false, reason: "cyclic" });
  });

  it("answers missing-ref for an absent note or id", () => {
    const formulas = collectFormulas(`{{@(x#other-note#nope)+1|0|id=ida}}\n`);
    const first = formulas[0];
    if (first?.expression == null) throw new Error("expected an executable pill");
    const outcome = resolveExpression(first.expression, { notes: new Map() }, NOTE, formulas);
    expect(outcome).toEqual({ ok: false, reason: "missing-ref" });
  });

  it("resolves across notes", () => {
    const other = collectFormulas("{{100|100|id=base;name=base}}\n");
    const local = collectFormulas(`{{@(base#other#base)*2|200|id=d}}\n`);
    const first = local[0];
    if (first?.expression == null) throw new Error("expected an executable pill");
    const outcome = resolveExpression(
      first.expression,
      { notes: new Map([["other", other]]) },
      NOTE,
      local,
    );
    expect(outcome).toEqual({ ok: true, value: 200 });
  });
});
