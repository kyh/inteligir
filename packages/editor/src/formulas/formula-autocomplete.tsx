// Picking a name inserts a pill that reads it, as typing the name would.

import { useMemo } from "react";
import { SigmaIcon } from "lucide-react";
import { KEYS, createTSlatePlugin } from "platejs";
import type { PluginConfig, TElement } from "platejs";
import { PlateElement, useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { withTriggerCombobox } from "@platejs/combobox";
import type { TriggerComboboxPluginOptions } from "@platejs/combobox";

import { InlineCombobox, matchesWords } from "@repo/editor/inline-combobox";
import type { PickerRow } from "@repo/editor/inline-combobox";
import { FORMULA_INPUT_KEY } from "@repo/editor/formulas/formula-input-key";
import { formulaInputBasePlugin } from "../kits/headless/picker-input-base";
import { stringProp } from "@repo/editor/node-props";
import { completeFormulaFromPicker } from "@repo/editor/formulas/formula-insert";
import { pillEntries, pillOf } from "@repo/editor/formulas/pill-nodes";

// a name the note's pills hold, once each, with what the pill it reads shows
interface VariableRow extends PickerRow {
  readonly name: string;
  readonly display: string;
}

const variableRows = (editorChildren: readonly TElement[]): VariableRow[] => {
  const rows = new Map<string, VariableRow>();
  for (const { node } of pillEntries(editorChildren)) {
    const { name } = pillOf(node);
    if (name !== undefined && !rows.has(name)) {
      rows.set(name, {
        display: stringProp(node, "display") ?? "",
        name,
        onSelect: (editor) => {
          completeFormulaFromPicker(editor, name);
        },
        value: name,
      });
    }
  }
  return [...rows.values()];
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
