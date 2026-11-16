// Picking a variable inserts a linked instance (same id); bound cross-note
// references stay an authoring act, the picker never guesses identity.

import { useMemo } from "react";
import { SigmaIcon } from "lucide-react";
import { ElementApi, KEYS, createTSlatePlugin } from "platejs";
import type { Descendant, PluginConfig, TElement } from "platejs";
import { PlateElement, useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { withTriggerCombobox } from "@platejs/combobox";
import type { TriggerComboboxPluginOptions } from "@platejs/combobox";

import { InlineCombobox, matchesWords } from "@repo/editor/inline-combobox";
import type { PickerRow } from "@repo/editor/inline-combobox";
import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";
import { FORMULA_INPUT_KEY } from "@repo/editor/formulas/formula-input-key";
import { formulaInputBasePlugin } from "../kits/headless/picker-input-base";
import { stringProp } from "@repo/editor/node-props";
import {
  completeFormulaFromPicker,
  insertFormulaFromPicker,
} from "@repo/editor/formulas/formula-insert";
import { formulaNodeFrom } from "@repo/editor/formulas/formula-entry";
import { parseFormulaMeta } from "@repo/editor/formulas/formula-meta";

// a variable the note names, once each
interface VariableRow extends PickerRow {
  readonly name: string;
  readonly display: string;
}

const variableRows = (editorChildren: readonly TElement[]): VariableRow[] => {
  const seen = new Set<string>();
  const out: VariableRow[] = [];
  const walk = (nodes: readonly Descendant[]): void => {
    for (const node of nodes) {
      if (!ElementApi.isElement(node)) {
        continue;
      }
      if (node.type === FORMULA_PILL_KEY) {
        const meta = stringProp(node, "meta") ?? "";
        const parsed = parseFormulaMeta(meta);
        const source = stringProp(node, "source") ?? "";
        const display = stringProp(node, "display") ?? "";
        // symbolic variables are named by their source
        const name = parsed.name ?? (parsed.id === undefined ? undefined : source);
        const key = parsed.id ?? name;
        if (name !== undefined && name !== "" && key !== undefined && !seen.has(key)) {
          seen.add(key);
          out.push({
            display,
            name,
            onSelect: (editor) => {
              insertFormulaFromPicker(editor, formulaNodeFrom({ display, meta, source }));
            },
            value: key,
          });
        }
      }
      walk(node.children);
    }
  };
  walk(editorChildren);
  return out;
};

const variableMatches = (variable: VariableRow, query: string): boolean =>
  matchesWords([variable.name], query);

const FormulaInputElement = (props: PlateElementProps) => {
  const { element } = props;
  const editor = useEditorRef();

  const variables = useMemo(() => variableRows(editor.children), [editor.children]);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        closeOn={{
          pick: (body) => {
            completeFormulaFromPicker(editor, body);
          },
          suffix: "}}",
          words: (body) => body,
        }}
        element={element}
        empty="Type an expression, then }}"
        filter={variableMatches}
        groups={[{ items: variables }]}
        trigger="{"
      >
        {(variable) => (
          <>
            <SigmaIcon className="mr-2 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate">{variable.name}</span>
              <span className="truncate text-body text-muted-foreground">{variable.display}</span>
            </span>
          </>
        )}
      </InlineCombobox>
      {props.children}
    </PlateElement>
  );
};

type FormulaTriggerConfig = PluginConfig<"formula_trigger", TriggerComboboxPluginOptions>;

export const FormulaAutocompleteKit = [
  createTSlatePlugin<FormulaTriggerConfig>({
    key: "formula_trigger",
    options: {
      createComboboxInput: () => ({ children: [{ text: "" }], type: FORMULA_INPUT_KEY }),
      trigger: "{",
      // only a `{` right before the typed `{` opens the picker; a lone brace stays literal
      triggerPreviousCharPattern: /^\{$/u,
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } }),
    },
  }).overrideEditor(withTriggerCombobox),
  formulaInputBasePlugin.withComponent(FormulaInputElement),
];
