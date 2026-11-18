import { evaluateExpression, parseExpression } from "./expression";
import type { ExpressionNode } from "./expression";
import { formatResult } from "./format-result";

export interface Pill {
  readonly name?: string | undefined;
  readonly source: string;
}

interface Row extends Pill {
  readonly expression: ExpressionNode | null;
}

export const displaysOf = (pills: readonly Pill[]) => {
  const rows: Row[] = pills.map((pill) => ({ ...pill, expression: parseExpression(pill.source) }));
  const named = new Map<string, Row>();

  for (const row of rows) {
    if (row.name !== undefined && !named.has(row.name)) {
      named.set(row.name, row);
    }
  }

  const values = new Map<Row, number | null>();

  const valueOf: (row: Row) => number | null = (row: Row) => {
    const known = values.get(row);

    if (known !== undefined) {
      return known;
    }

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

  const textOf = (row: Row) => {
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
