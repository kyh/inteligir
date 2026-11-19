import type { SlateEditor, TElement } from "platejs";

import { FORMULA_PILL_KEY } from "@repo/editor/headless/dialect-node-keys";
import type { Pill } from "@repo/editor/headless/formulas/displays";
import { isPillName, namesIn, parseExpression } from "@repo/editor/headless/formulas/expression";
import { pillEntries, pillOf } from "@repo/editor/headless/formulas/pill-nodes";

const typedOf = (entry: string) => entry.trim().replace(/^=/u, "");

const namedPill = (typed: string) => {
  const equals = typed.indexOf("=");
  const name = typed.slice(0, Math.max(equals, 0)).trim();
  const source = typed.slice(equals + 1).trim();

  return (isPillName(name) && source !== "" ? { name, source } : null) satisfies Pill | null;
};

export const pillFromEntry = (entry: string, names: ReadonlySet<string>) => {
  const typed = typedOf(entry);
  const named = namedPill(typed);

  if (named !== null) {
    return named;
  }

  const expression = parseExpression(typed);

  return (
    expression !== null && namesIn(expression).every((read) => names.has(read))
      ? { source: typed }
      : null
  ) satisfies Pill | null;
};

export const entryName = (entry: string) => namedPill(typedOf(entry))?.name;

export const entryTextOf = ({ name, source }: Pill) =>
  name === undefined ? source : `${name}=${source}`;

export const pillFromEntryIn = (editor: SlateEditor, entry: string) =>
  pillFromEntry(
    entry,
    new Set(pillEntries(editor.children).flatMap(({ node }) => pillOf(node).name ?? [])),
  );

export const pillNode = ({ name, source }: Pill) => {
  const node: TElement = { children: [{ text: "" }], display: "", source, type: FORMULA_PILL_KEY };

  if (name !== undefined) {
    node.name = name;
  }

  return node;
};
