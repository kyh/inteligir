// What each pill of one item shows, from the pills' names and sources alone: a formula's value, or
// the pill's own source where it has none (text, a name no pill holds, a pill that reads itself, a
// division by zero). Pure, so the editor's normalizer and the markdown read settle one display.

import { evaluateExpression, parseExpression } from "./expression";
import type { ExpressionNode } from "./expression";
import { formatResult } from "./format-result";

export interface Pill {
  // what another pill's source reads this one by
  readonly name?: string | undefined;
  readonly source: string;
}

interface Row extends Pill {
  readonly expression: ExpressionNode | null;
}

// `pills` in reading order, which decides a name two of them hold: the first is the one read
export const displaysOf = (pills: readonly Pill[]): string[] => {
  const rows: Row[] = pills.map((pill) => ({ ...pill, expression: parseExpression(pill.source) }));
  const named = new Map<string, Row>();
  for (const row of rows) {
    if (row.name !== undefined && !named.has(row.name)) {
      named.set(row.name, row);
    }
  }

  const values = new Map<Row, number | null>();
  const valueOf = (row: Row): number | null => {
    const known = values.get(row);
    if (known !== undefined) {
      return known;
    }
    // none while it is worked out, so a pill that reads itself through any others has none
    values.set(row, null);
    const value =
      row.expression === null
        ? null
        : evaluateExpression(row.expression, (name) => {
            const target = named.get(name);
            return target === undefined ? null : valueOf(target);
          });
    values.set(row, value);
    return value;
  };

  // a pill that only names another shows what that one shows, so a name can stand for text
  const textOf = (row: Row): string => {
    const seen = new Set<Row>();
    let at = row;
    for (;;) {
      seen.add(at);
      const next = at.expression?.kind === "ref" ? named.get(at.expression.name) : undefined;
      if (next === undefined) {
        return at.source;
      }
      if (seen.has(next)) {
        return row.source;
      }
      at = next;
    }
  };

  return rows.map((row) => {
    const value = valueOf(row);
    return value === null ? textOf(row) : formatResult(value);
  });
};
