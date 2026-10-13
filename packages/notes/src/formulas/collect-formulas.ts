// Parsed, not regexed: a pill inside a code fence is literal in the editor and must be here too.

import { SKIP, visit } from "unist-util-visit";

import { parseMdast } from "../markdown/parse";
import { parseFormulaMeta } from "./formula-meta";
import type { FormulaMeta } from "./formula-meta";
import { parseExpression } from "./expression";
import type { ExpressionNode } from "./expression";

export interface CollectedFormula {
  source: string;
  display: string;
  meta: FormulaMeta;
  /** null = symbolic (not executable). */
  expression: ExpressionNode | null;
}

export const collectFormulas = (markdown: string): CollectedFormula[] => {
  const collected: CollectedFormula[] = [];
  visit(parseMdast(markdown).root, "formulaPill", (node) => {
    const { source, display, meta } = node;
    collected.push({
      display,
      expression: parseExpression(source),
      meta: parseFormulaMeta(meta),
      source,
    });
    return SKIP;
  });
  return collected;
};

export const formulasById = (
  formulas: readonly CollectedFormula[],
): Map<string, CollectedFormula> => {
  const byId = new Map<string, CollectedFormula>();
  for (const formula of formulas) {
    const { id } = formula.meta;
    if (id !== undefined && id !== "" && !byId.has(id)) {
      byId.set(id, formula);
    }
  }
  return byId;
};
