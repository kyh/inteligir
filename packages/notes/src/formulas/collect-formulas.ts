// A pill as the formula graph reads it, an item's pills as its blocks hold them, and a note's pills
// by their linked id.

import type { LibraryNode } from "../library/library-nodes";
import { parseExpression } from "./expression";
import type { ExpressionNode } from "./expression";
import { parseFormulaMeta } from "./formula-meta";
import type { FormulaMeta } from "./formula-meta";

export interface CollectedFormula {
  source: string;
  display: string;
  meta: FormulaMeta;
  /** null = symbolic (not executable). */
  expression: ExpressionNode | null;
}

// every pill under the blocks, in reading order; a code block holds its lines as text, so a pill
// written inside one is never a pill here, as the editor draws it
export const formulasInBlocks = (blocks: readonly LibraryNode[]): CollectedFormula[] => {
  const collected: CollectedFormula[] = [];
  // walked without recursion, depth first and left to right, so the pills come out in the order
  // they read
  const pending = [...blocks].toReversed();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ("text" in node) {
      continue;
    }
    if (node.type === "formulaPill") {
      collected.push({
        display: node.display,
        expression: parseExpression(node.source),
        meta: parseFormulaMeta(node.meta),
        source: node.source,
      });
      continue;
    }
    pending.push(...[...node.children].toReversed());
  }
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
