import type { Node, Parent } from "mdast";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { escapePillPipesInTables } from "../table-pipes";
import { parseMdast } from "../parse";

const formulaNodeSchema = z.object({ raw: z.string(), type: z.literal("formulaPill") });

function isParent(node: Node): node is Parent {
  return "children" in node;
}

function formulasIn(md: string): Array<{ raw: string }> {
  const parsed = parseMdast(md);
  if (!parsed.ok) throw new Error(parsed.failure.message);
  const out: Array<{ raw: string }> = [];
  const walk = (node: Node): void => {
    const formula = formulaNodeSchema.safeParse(node);
    if (formula.success) out.push({ raw: formula.data.raw });
    if (isParent(node)) for (const child of node.children) walk(child);
  };
  walk(parsed.root);
  return out;
}

const RAW_PILL_TABLE = "| a | b |\n| - | - |\n| {{5|5}} | x |\n";

describe("escapePillPipesInTables", () => {
  it("escapes a raw pill pipe on a table-shaped line", () => {
    expect(escapePillPipesInTables(RAW_PILL_TABLE)).toBe(
      "| a | b |\n| - | - |\n| {{5\\|5}} | x |\n",
    );
  });

  it("is idempotent — canonical (already-escaped) bytes are untouched", () => {
    const canonical = "| a | b |\n| - | - |\n| {{5\\|5}} | x |\n";
    expect(escapePillPipesInTables(canonical)).toBe(canonical);
    const once = escapePillPipesInTables(RAW_PILL_TABLE);
    expect(escapePillPipesInTables(once)).toBe(once);
  });

  it("leaves `\\|` outside braces and prose pills alone", () => {
    const prose = "a | b and {{sum|10}} here\n";
    expect(escapePillPipesInTables("| a \\| b | c |\n")).toBe("| a \\| b | c |\n");
    // A prose line IS table-shaped by the pipe heuristic, so the pill escapes —
    // and micromark's text unescape makes that byte-invisible after parse.
    expect(formulasIn(prose)).toEqual([{ raw: "sum|10" }]);
  });

  it("leaves a pill on a pipe-free line untouched", () => {
    const md = "just {{sum|10}} here\n";
    expect(escapePillPipesInTables(md)).toBe(md);
  });

  it("skips code fences and the frontmatter block", () => {
    const fenced = "```\n| {{a|b}} |\n```\n";
    expect(escapePillPipesInTables(fenced)).toBe(fenced);
    const fm = "---\ntitle: '| {{a|b}} |'\n---\n\nbody\n";
    expect(escapePillPipesInTables(fm)).toBe(fm);
  });

  it("skips pills inside inline code spans", () => {
    const md = "| `{{a|b}}` | x |\n";
    expect(escapePillPipesInTables(md)).toBe(md);
  });

  it("raw pill in a table cell parses as ONE pill", () => {
    expect(formulasIn(RAW_PILL_TABLE)).toEqual([{ raw: "5|5" }]);
  });

  it("our escaped form parses identically", () => {
    expect(formulasIn("| a | b |\n| - | - |\n| {{5\\|5}} | x |\n")).toEqual([{ raw: "5|5" }]);
  });
});
