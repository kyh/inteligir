// `{{` formula autocomplete — the fourth inline-combobox consumer. Typing `{`
// after `{` swaps in a trigger element listing this NOTE's named variables;
// picking one inserts a LINKED INSTANCE (same id — the skill's linked-instance
// rule: edits to any instance update all), which is the reference form that
// needs no note id. Bound cross-note references stay an authoring/agent act —
// the picker never guesses identity. Typing a full entry and the closing `}}`
// completes verbatim, fluent-typing parity with the kit's `}` input rule.

import { useMemo, useState } from "react";
import { SigmaIcon } from "lucide-react";
import {
  ElementApi,
  KEYS,
  createTSlatePlugin,
  type Descendant,
  type PluginConfig,
  type TElement,
} from "platejs";
import {
  PlateElement,
  createPlatePlugin,
  useEditorRef,
  type PlateElementProps,
} from "platejs/react";
import { withTriggerCombobox, type TriggerComboboxPluginOptions } from "@platejs/combobox";

import { commitComboboxInput } from "@repo/editor/combobox-input";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxItem,
  InlineComboboxInput,
} from "@repo/editor/inline-combobox";
import { FORMULA_INPUT_KEY } from "@repo/editor/formula-input-key";
import { stringProp } from "@repo/editor/node-props";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import {
  formulaNodeFrom,
  formulaPropsFromEntry,
  rebuildRaw,
} from "@repo/editor/formulas/formula-entry";
import { parseFormulaMeta } from "@repo/notes/formulas/formula-meta";
import { parseFormulaRaw } from "@repo/notes/markdown/remark-inline-constructs";

type NamedVariable = {
  name: string;
  source: string;
  display: string;
  meta: string;
};

/** This note's named variables, first instance per id (linked instances share
 * their value by definition). */
function collectNamedVariables(editorChildren: readonly TElement[]): NamedVariable[] {
  const seen = new Set<string>();
  const out: NamedVariable[] = [];
  const walk = (nodes: readonly Descendant[]): void => {
    for (const node of nodes) {
      if (!ElementApi.isElement(node)) continue;
      if (node.type === "formulaPill") {
        const meta = stringProp(node, "meta") ?? "";
        const parsed = parseFormulaMeta(meta);
        const source = stringProp(node, "source") ?? "";
        const display = stringProp(node, "display") ?? "";
        // Symbolic variables are named by their source.
        const name = parsed.name ?? (parsed.id !== undefined ? source : undefined);
        const key = parsed.id ?? name;
        if (name !== undefined && name !== "" && key !== undefined && !seen.has(key)) {
          seen.add(key);
          out.push({ display, meta, name, source });
        }
      }
      walk(node.children);
    }
  };
  walk(editorChildren);
  return out;
}

function FormulaInputElement(props: PlateElementProps) {
  const { children, element } = props;
  const editor = useEditorRef();
  const [value, setValue] = useState("");

  const variables = useMemo(() => collectNamedVariables(editor.children), [editor.children]);

  const insertPill = (pill: TElement): void => {
    insertVoidAndEscape(editor, pill);
  };

  const completeEntry = (entry: string): void => {
    const props2 = entry.includes("|")
      ? { ...parseFormulaRaw(entry), raw: entry }
      : formulaPropsFromEntry(entry);
    commitComboboxInput(editor, element, true);
    if (props2 === null) {
      editor.tf.insertText(`{{${entry}}}`);
      return;
    }
    insertPill(
      formulaNodeFrom({
        display: props2.display,
        meta: "meta" in props2 ? (props2.meta ?? "") : "",
        raw: props2.raw,
        source: props2.source,
      }),
    );
  };

  const onValueChange = (next: string): void => {
    if (next.endsWith("}}") && next.slice(0, -2) !== "") {
      completeEntry(next.slice(0, -2));
      return;
    }
    setValue(next);
  };

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="{" value={value} setValue={onValueChange}>
        <InlineComboboxInput />
        <InlineComboboxContent>
          <InlineComboboxEmpty>Type an expression, then {"}}"}</InlineComboboxEmpty>
          <InlineComboboxGroup>
            {variables.map((variable) => (
              <InlineComboboxItem
                key={variable.name}
                value={variable.name}
                label={variable.name}
                keywords={[variable.name]}
                onClick={() => {
                  // A linked instance: same id, same value — the pill's raw is
                  // rebuilt so bytes and props always agree.
                  commitComboboxInput(editor, element, true);
                  insertPill(
                    formulaNodeFrom({
                      display: variable.display,
                      meta: variable.meta,
                      raw: rebuildRaw(variable.source, variable.display, variable.meta),
                      source: variable.source,
                    }),
                  );
                }}
              >
                <SigmaIcon className="mr-2 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate">{variable.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{variable.display}</span>
                </span>
              </InlineComboboxItem>
            ))}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>
      {children}
    </PlateElement>
  );
}

type FormulaTriggerConfig = PluginConfig<"formula_trigger", TriggerComboboxPluginOptions>;

export const FormulaAutocompleteKit = [
  createTSlatePlugin<FormulaTriggerConfig>({
    key: "formula_trigger",
    options: {
      trigger: "{",
      // Only a `{` immediately before the typed `{` opens the picker — a lone
      // brace elsewhere stays literal (and MDX expressions stay MDX's).
      triggerPreviousCharPattern: /^\{$/u,
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } }),
      createComboboxInput: () => ({ children: [{ text: "" }], type: FORMULA_INPUT_KEY }),
    },
  }).overrideEditor(withTriggerCombobox),
  createPlatePlugin({
    key: FORMULA_INPUT_KEY,
    node: { isElement: true, isInline: true, isVoid: true },
  }).withComponent(FormulaInputElement),
];
