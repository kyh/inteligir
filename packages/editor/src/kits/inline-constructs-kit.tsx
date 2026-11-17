import { KEYS, NodeApi, TextApi } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { stringProp } from "@repo/editor/node-props";
import { convertFormulaToText, FormulaEditForm } from "@repo/editor/formulas/formula-edit";
import { entryTextOf, pillFromEntryIn, pillNode } from "@repo/editor/formulas/formula-entry";
import { isFormulaPill, pillOf } from "@repo/editor/formulas/pill-nodes";
import { useEditPopover } from "@repo/editor/nodes/edit-popover";

import { formulaPillBasePlugin } from "./headless/inline-constructs-base";

const FormulaPillElement = (props: PlateElementProps) => {
  const { open, setOpen } = useEditPopover();
  return (
    <PlateElement {...props} as="span" className="relative inline-block">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          contentEditable={false}
          draggable={false}
          title={entryTextOf(pillOf(props.element))}
          className="cursor-pointer rounded-sm bg-accent px-1 font-medium text-accent-foreground tabular-nums"
        >
          {stringProp(props.element, "display")}
        </PopoverTrigger>
        <PopoverContent initialFocus side="bottom" align="start" className="w-auto p-1">
          <FormulaEditForm
            element={props.element}
            onDone={() => {
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {props.children}
    </PlateElement>
  );
};

const FORMULA_COMPLETION_RE = /\{\{(?<body>[^{}\n]+)\}$/u;

const completeFormulaPill = (editor: SlateEditor): boolean => {
  if (!editor.selection || !editor.api.isCollapsed()) {
    return false;
  }
  if (editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } })) {
    return false;
  }
  const { anchor } = editor.selection;
  const leaf = NodeApi.get(editor, anchor.path);
  if (!leaf || !TextApi.isText(leaf)) {
    return false;
  }
  const match = FORMULA_COMPLETION_RE.exec(leaf.text.slice(0, anchor.offset));
  if (!match) {
    return false;
  }
  const [full] = match;
  const body = match.groups?.body;
  if (body === undefined || body === "") {
    return false;
  }
  const pill = pillFromEntryIn(editor, body);
  if (pill === null) {
    return false;
  }
  editor.tf.withoutNormalizing(() => {
    editor.tf.delete({
      at: {
        anchor: { offset: anchor.offset - full.length, path: anchor.path },
        focus: anchor,
      },
    });
  });
  insertVoidAndEscape(editor, pillNode(pill));
  return true;
};

// Slate parks a selected inline void's caret in its empty text child.
const selectedFormula = (editor: SlateEditor) => {
  if (!editor.selection || !editor.api.isCollapsed()) {
    return null;
  }
  const entry = editor.api.above<TElement>({
    at: editor.selection,
    match: isFormulaPill,
  });
  return entry ?? null;
};

export const InlineConstructsKit = [
  formulaPillBasePlugin
    .withComponent(FormulaPillElement)
    .overrideEditor(({ editor, tf: { insertText, deleteBackward } }) => ({
      transforms: {
        deleteBackward(unit) {
          const entry = selectedFormula(editor);
          if (entry !== null) {
            convertFormulaToText(editor, entry[0]);
            return;
          }
          deleteBackward(unit);
        },
        insertText(text, options) {
          if (text === "}" && completeFormulaPill(editor)) {
            return;
          }
          insertText(text, options);
        },
      },
    })),
];
