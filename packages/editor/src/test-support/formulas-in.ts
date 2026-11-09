// A note's pills as a host would read them out of its markdown, parsed rather than regexed, so a
// pill inside a code fence is literal: what the formula suites build a graph's notes from.

import { ElementApi, NodeApi } from "platejs";

import type { CollectedFormula } from "../formulas/collect-formulas";
import { parseExpression } from "../formulas/expression";
import { isFormulaPill } from "../formulas/formula-entry";
import { parseFormulaMeta } from "../formulas/formula-meta";
import { parseMarkdown } from "../markdown/markdown-doc";
import { stringProp } from "../node-props";

// a pill in the dialect's spelling, so a suite writes one by its parts
/** @internal */
export const pillMarkdown = (source: string, display: string, meta = ""): string =>
  `:formula[${display}]{source="${source}"${meta === "" ? "" : ` meta="${meta}"`}}`;

/** @internal */
export const formulasIn = (markdown: string): CollectedFormula[] => {
  const read = parseMarkdown(markdown);
  if (!read.ok) {
    throw new Error(`the markdown did not read: ${read.reason.kind}`);
  }
  const collected: CollectedFormula[] = [];
  for (const block of read.value) {
    for (const [node] of NodeApi.nodes(block)) {
      if (ElementApi.isElement(node) && isFormulaPill(node)) {
        const source = stringProp(node, "source") ?? "";
        collected.push({
          display: stringProp(node, "display") ?? "",
          expression: parseExpression(source),
          meta: parseFormulaMeta(stringProp(node, "meta")),
          source,
        });
      }
    }
  }
  return collected;
};
