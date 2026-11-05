// A pill as the formula graph reads it, and a note's pills by their linked id.

import type { FormulaMeta } from "./formula-meta";
import type { ExpressionNode } from "./expression";

export interface CollectedFormula {
  source: string;
  display: string;
  meta: FormulaMeta;
  /** null = symbolic (not executable). */
  expression: ExpressionNode | null;
}

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
