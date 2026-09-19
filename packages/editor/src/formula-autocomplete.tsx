// Picking a variable inserts a linked instance (same id); bound cross-note
// references stay an authoring act, the picker never guesses identity.

import { useMemo, useState } from "react";
import { SigmaIcon } from "lucide-react";
import { ElementApi, KEYS, createTSlatePlugin } from "platejs";
import type { Descendant, PluginConfig, TElement } from "platejs";
import { PlateElement, createPlatePlugin, useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { withTriggerCombobox } from "@platejs/combobox";
import type { TriggerComboboxPluginOptions } from "@platejs/combobox";

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

interface NamedVariable {
  name: string;
  source: string;
  display: string;
  meta: string;
}

const collectNamedVariables = (editorChildren: readonly TElement[]): NamedVariable[] => {
  const seen = new Set<string>();
  const out: NamedVariable[] = [];
  const walk = (nodes: readonly Descendant[]): void => {
    for (const node of nodes) {
      if (!ElementApi.isElement(node)) {
        continue;
      }
      if (node.type === "formulaPill") {
        const meta = stringProp(node, "meta") ?? "";
        const parsed = parseFormulaMeta(meta);
        const source = stringProp(node, "source") ?? "";
        const display = stringProp(node, "display") ?? "";
        // symbolic variables are named by their source
        const name = parsed.name ?? (parsed.id === undefined ? undefined : source);
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
};

const FormulaInputElement = (props: PlateElementProps) => {
  const { element } = props;
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
      // only a `{` right before the typed `{` opens the picker; a lone brace stays literal and MDX expressions stay MDX's
      triggerPreviousCharPattern: /^\{$/u,
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } }),
    },
  }).overrideEditor(withTriggerCombobox),
  createPlatePlugin({
    key: FORMULA_INPUT_KEY,
    node: { isElement: true, isInline: true, isVoid: true },
  }).withComponent(FormulaInputElement),
];
