// The editor-entry grammar and the pill node's construction, shared by the
// `{{` autocomplete, the `}}` completion rule, the edit popover and the
// recompute pass — one place decides what typed text becomes.
//
// Entry forms (the vendored skill's own): `=2+2` / `2+2` → anonymous
// executable; `sum=2+2` → named executable (fresh id); `time=9am` → symbolic
// (name IS the source, value IS the display, fresh id). Persisted display for
// an executable is computed by the caller (recompute owns cross-note refs).

import type { TElement } from "platejs";

import { parseExpression } from "@repo/notes/formulas/expression";
import { evaluateExpression } from "@repo/notes/formulas/expression";
import { formatResult } from "@repo/notes/formulas/format-result";
import {
  parseFormulaMeta,
  serializeFormulaMeta,
  type FormulaMeta,
} from "@repo/notes/formulas/formula-meta";

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

/**
 * Turn entry text into pill props. `existing` carries the pill being edited
 * (its id survives a rewrite — linked instances stay linked); a fresh entry
 * mints an id exactly where the spec requires one (named executables and
 * symbolic variables), and an anonymous executable keeps the two-field form.
 */
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
    if (expression === null) return null; // bare non-executable text is not a pill
    const outcome = evaluateExpression(expression, () => null);
    const display = outcome.ok ? formatResult(outcome.value) : "";
    // Anonymous — but an EDIT of a named/identified pill keeps its identity.
    const { name: _dropName, ...anonymous } = prior;
    return propsFrom(trimmed, display, { ...anonymous, stale: false });
  }
  const [, name, rest] = named;
  if (name === undefined || rest === undefined) return null;
  const expression = parseExpression(rest);
  if (expression !== null) {
    const outcome = evaluateExpression(expression, () => null);
    // A bound-ref entry has no local value yet; recompute fills it.
    const display = outcome.ok ? formatResult(outcome.value) : "";
    return propsFrom(rest, display, {
      ...prior,
      id: prior.id ?? mintFormulaId(),
      name,
      stale: false,
    });
  }
  // Symbolic: the name is the source, the value is the display.
  const { name: _symbolicName, ...symbolic } = prior;
  return propsFrom(name, rest, {
    ...symbolic,
    id: prior.id ?? mintFormulaId(),
    stale: false,
  });
}

/** The entry text an existing pill edits as (the inverse of the above). */
export function entryTextOf(element: TElement): string {
  const source = typeof element.source === "string" ? element.source : "";
  const display = typeof element.display === "string" ? element.display : "";
  const meta = parseFormulaMeta(typeof element.meta === "string" ? element.meta : undefined);
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
