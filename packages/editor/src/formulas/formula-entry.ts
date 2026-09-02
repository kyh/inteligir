// Entry forms: `=2+2` / `2+2` anonymous executable; `sum=2+2` named executable
// (fresh id); `time=9am` symbolic (the name is the source, the value the display, fresh id).

import type { TElement } from "platejs";

import { parseExpression } from "@repo/notes/formulas/expression";
import { evaluateExpression } from "@repo/notes/formulas/expression";
import { formatResult } from "@repo/notes/formulas/format-result";
import {
  parseFormulaMeta,
  serializeFormulaMeta,
  type FormulaMeta,
} from "@repo/notes/formulas/formula-meta";
import { stringProp } from "@repo/editor/node-props";

const NAME_RE = /^([A-Za-z][A-Za-z0-9_-]*)=(.+)$/u;

export type FormulaNodeProps = {
  source: string;
  display: string;
  meta: string;
  raw: string;
};

export function mintFormulaId(): string {
  return crypto.randomUUID();
}

export function rebuildRaw(source: string, display: string, meta: string): string {
  return meta === "" ? `${source}|${display}` : `${source}|${display}|${meta}`;
}

function propsFrom(source: string, display: string, meta: FormulaMeta): FormulaNodeProps {
  const serialized = serializeFormulaMeta(meta) ?? "";
  return {
    display,
    meta: serialized,
    raw: rebuildRaw(source, display, serialized),
    source,
  };
}

// `existing` keeps the edited pill's id so linked instances stay linked.
export function formulaPropsFromEntry(
  entry: string,
  existing?: { meta: string },
): FormulaNodeProps | null {
  const trimmed = entry.trim().replace(/^=/u, "");
  if (trimmed === "") return null;
  const prior = parseFormulaMeta(existing?.meta);
  const named = NAME_RE.exec(trimmed);
  if (named === null) {
    const expression = parseExpression(trimmed);
    if (expression === null) return null;
    const outcome = evaluateExpression(expression, () => null);
    const display = outcome.ok ? formatResult(outcome.value) : "";
    const { name: _dropName, ...anonymous } = prior;
    return propsFrom(trimmed, display, { ...anonymous, stale: false });
  }
  const [, name, rest] = named;
  if (name === undefined || rest === undefined) return null;
  const expression = parseExpression(rest);
  if (expression !== null) {
    const outcome = evaluateExpression(expression, () => null);
    const display = outcome.ok ? formatResult(outcome.value) : "";
    return propsFrom(rest, display, {
      ...prior,
      id: prior.id ?? mintFormulaId(),
      name,
      stale: false,
    });
  }
  const { name: _symbolicName, ...symbolic } = prior;
  return propsFrom(name, rest, {
    ...symbolic,
    id: prior.id ?? mintFormulaId(),
    stale: false,
  });
}

export function entryTextOf(element: TElement): string {
  const source = stringProp(element, "source") ?? "";
  const display = stringProp(element, "display") ?? "";
  const meta = parseFormulaMeta(stringProp(element, "meta"));
  if (meta.name !== undefined && meta.name !== "") return `${meta.name}=${source}`;
  if (parseExpression(source) !== null) return source;
  return `${source}=${display}`;
}

export function formulaNodeFrom(props: FormulaNodeProps): TElement {
  return {
    children: [{ text: "" }],
    display: props.display,
    meta: props.meta,
    raw: props.raw,
    source: props.source,
    type: "formulaPill",
  };
}
