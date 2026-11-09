// Entry forms: `=2+2` / `2+2` anonymous executable; `sum=2+2` named executable
// (fresh id); `time=9am` symbolic (the name is the source, the value the display, fresh id).

import { ElementApi } from "platejs";
import type { Path, SlateEditor, TElement, TNode } from "platejs";

import { parseExpression, evaluateExpression } from "@repo/editor/formulas/expression";
import { formatResult } from "@repo/editor/formulas/format-result";
import { parseFormulaMeta, serializeFormulaMeta } from "@repo/editor/formulas/formula-meta";
import type { FormulaMeta } from "@repo/editor/formulas/formula-meta";
import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";
import { stringProp } from "@repo/editor/node-props";

const NAME_RE = /^(?<name>[A-Za-z][A-Za-z0-9_-]*)=(?<rest>.+)$/u;

// `meta` is "" for a pill that names no id: the node then holds none
export interface FormulaNodeProps {
  source: string;
  display: string;
  meta: string;
}

export const isFormulaPill = (node: TNode): node is TElement =>
  ElementApi.isElement(node) && node.type === FORMULA_PILL_KEY;

const mintFormulaId = (): string => crypto.randomUUID();

const propsFrom = (source: string, display: string, meta: FormulaMeta): FormulaNodeProps => ({
  display,
  meta: serializeFormulaMeta(meta) ?? "",
  source,
});

// `existing` keeps the edited pill's id so linked instances stay linked.
export const formulaPropsFromEntry = (
  entry: string,
  existing?: { meta: string },
): FormulaNodeProps | null => {
  const trimmed = entry.trim().replace(/^=/u, "");
  if (trimmed === "") {
    return null;
  }
  const prior = parseFormulaMeta(existing?.meta);
  const named = NAME_RE.exec(trimmed);
  if (named === null) {
    const expression = parseExpression(trimmed);
    if (expression === null) {
      return null;
    }
    const outcome = evaluateExpression(expression, () => null);
    const display = outcome.ok ? formatResult(outcome.value) : "";
    const { name: _dropName, ...anonymous } = prior;
    return propsFrom(trimmed, display, { ...anonymous, stale: false });
  }
  const { name, rest } = named.groups ?? {};
  if (name === undefined || rest === undefined) {
    return null;
  }
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
};

export const entryTextOf = (element: TElement): string => {
  const source = stringProp(element, "source") ?? "";
  const display = stringProp(element, "display") ?? "";
  const meta = parseFormulaMeta(stringProp(element, "meta"));
  if (meta.name !== undefined && meta.name !== "") {
    return `${meta.name}=${source}`;
  }
  if (parseExpression(source) !== null) {
    return source;
  }
  return `${source}=${display}`;
};

// a pill's parts set on the pill at `at`; a meta of "" names no id, so the node holds none
export const setFormulaPill = (
  editor: SlateEditor,
  at: Path,
  props: Pick<FormulaNodeProps, "display" | "meta"> & Partial<Pick<FormulaNodeProps, "source">>,
): void => {
  const { meta, ...parts } = props;
  editor.tf.setNodes(meta === "" ? parts : { ...parts, meta }, { at });
  if (meta === "") {
    editor.tf.unsetNodes("meta", { at });
  }
};

// the pill as the library holds it: its bytes are derived from these parts when it is written
export const formulaNodeFrom = (props: FormulaNodeProps): TElement => {
  const pill: TElement = {
    children: [{ text: "" }],
    display: props.display,
    source: props.source,
    type: FORMULA_PILL_KEY,
  };
  if (props.meta !== "") {
    pill.meta = props.meta;
  }
  return pill;
};

// a typed `{{source|display|meta}}`: the display after the first pipe, the meta after the second
const formulaPartsOf = (raw: string): FormulaNodeProps => {
  const [source = "", display = "", ...meta] = raw.split("|");
  return { display, meta: meta.join("|"), source };
};

// A body with pipes completes verbatim; a pipeless body runs the entry grammar.
export const formulaNodeFromTyped = (body: string): TElement | null => {
  if (body.includes("|")) {
    return formulaNodeFrom(formulaPartsOf(body));
  }
  const props = formulaPropsFromEntry(body);
  return props === null ? null : formulaNodeFrom(props);
};
