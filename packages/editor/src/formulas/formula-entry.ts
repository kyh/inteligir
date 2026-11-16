// What a person types for a pill, in `{{…}}` or in its editor: a formula (`2+2`, `=2+2`,
// `price*qty`), or `name=…` to name one, whose source is a formula or any text (`time=9am`).

import type { SlateEditor, TElement } from "platejs";

import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";
import type { Pill } from "@repo/editor/formulas/displays";
import { isPillName, namesIn, parseExpression } from "@repo/editor/formulas/expression";
import { pillEntries, pillOf } from "@repo/editor/formulas/pill-nodes";

// The pill an entry spells, or null for one that spells none and stays the text it is. A bare
// formula is one only when a pill holds every name it reads, since any word is a name; a named
// pill takes any source, so it can be written ahead of what it reads.
export const pillFromEntry = (entry: string, names: ReadonlySet<string>): Pill | null => {
  const typed = entry.trim().replace(/^=/u, "");
  const equals = typed.indexOf("=");
  const name = typed.slice(0, Math.max(equals, 0)).trim();
  const source = typed.slice(equals + 1).trim();
  if (isPillName(name) && source !== "") {
    return { name, source };
  }
  const expression = parseExpression(typed);
  return expression !== null && namesIn(expression).every((read) => names.has(read))
    ? { source: typed }
    : null;
};

export const entryTextOf = ({ name, source }: Pill): string =>
  name === undefined ? source : `${name}=${source}`;

// the pill an entry typed into `editor` spells, read against the names its note holds
export const pillFromEntryIn = (editor: SlateEditor, entry: string): Pill | null =>
  pillFromEntry(
    entry,
    new Set(pillEntries(editor.children).flatMap(({ node }) => pillOf(node).name ?? [])),
  );

// the pill as a node, its display left for the normalizer every editor of a note runs
// (`kits/headless/inline-constructs-base.ts`)
export const pillNode = ({ name, source }: Pill): TElement => {
  const node: TElement = { children: [{ text: "" }], display: "", source, type: FORMULA_PILL_KEY };
  if (name !== undefined) {
    node.name = name;
  }
  return node;
};
