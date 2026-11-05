// A note's pills as a host would read them out of its markdown, parsed rather than regexed, so a
// pill inside a code fence is literal: what the formula suites build a graph's notes from.

import { SKIP, visit } from "unist-util-visit";

import type { CollectedFormula } from "../formulas/collect-formulas";
import { parseExpression } from "../formulas/expression";
import { parseFormulaMeta } from "../formulas/formula-meta";
import { parseMdast } from "../markdown/parse";

export const formulasIn = (markdown: string): CollectedFormula[] => {
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
