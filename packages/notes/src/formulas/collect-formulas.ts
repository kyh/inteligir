// Parsed, not regexed: a pill inside a code fence is literal in the editor and must be here too.

import type { Node, Parent } from "mdast";
import { z } from "zod";

import { splitFrontmatter } from "../markdown/frontmatter";
import { parseMdast } from "../markdown/parse";
import { parseFormulaMeta, type FormulaMeta } from "./formula-meta";
import { parseExpression, type ExpressionNode } from "./expression";

export type CollectedFormula = {
  source: string;
  display: string;
  meta: FormulaMeta;
  /** null = symbolic (not executable). */
  expression: ExpressionNode | null;
};

const frontmatterIdSchema = z.object({ id: z.string().min(1) });

export function noteIdOf(markdown: string): string | null {
  const { properties } = splitFrontmatter(markdown);
  const parsed = frontmatterIdSchema.safeParse(properties);
  return parsed.success ? parsed.data.id : null;
}

const formulaNodeSchema = z.object({
  display: z.string(),
  meta: z.string().optional(),
  source: z.string(),
  type: z.literal("formulaPill"),
});

function isParent(node: Node): node is Parent {
  return "children" in node;
}

// [] for an unparseable doc: a false "none" here only yields stale marks, never data loss
export function collectFormulas(markdown: string): CollectedFormula[] {
  const parsed = parseMdast(markdown);
  if (!parsed.ok) return [];
  const collected: CollectedFormula[] = [];
  walk(parsed.root);
  return collected;

  function walk(node: Node): void {
    const formula = formulaNodeSchema.safeParse(node);
    if (formula.success) {
      const { source, display, meta } = formula.data;
      collected.push({
        display,
        expression: parseExpression(source),
        meta: parseFormulaMeta(meta),
        source,
      });
      return;
    }
    if (isParent(node)) {
      for (const child of node.children) walk(child);
    }
  }
}

export function formulasById(formulas: readonly CollectedFormula[]): Map<string, CollectedFormula> {
  const byId = new Map<string, CollectedFormula>();
  for (const formula of formulas) {
    const id = formula.meta.id;
    if (id !== undefined && id !== "" && !byId.has(id)) byId.set(id, formula);
  }
  return byId;
}
