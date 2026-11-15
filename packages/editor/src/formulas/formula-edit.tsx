import { useState } from "react";
import type { NodeEntry, SlateEditor, TElement } from "platejs";
import { useEditorRef } from "platejs/react";

import { parseFormulaMeta } from "@repo/editor/formulas/formula-meta";
import {
  entryTextOf,
  formulaPropsFromEntry,
  isFormulaPill,
  setFormulaPill,
} from "@repo/editor/formulas/formula-entry";
import type { FormulaNodeProps } from "@repo/editor/formulas/formula-entry";
import { stringProp } from "@repo/editor/node-props";

const formulaEntriesById = (editor: SlateEditor, id: string): NodeEntry<TElement>[] => {
  const out: NodeEntry<TElement>[] = [];
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: isFormulaPill,
  })) {
    const meta = parseFormulaMeta(stringProp(entry[0], "meta"));
    if (meta.id === id) {
      out.push(entry);
    }
  }
  return out;
};

const applyFormulaEdit = (
  editor: SlateEditor,
  element: TElement,
  props: FormulaNodeProps,
): void => {
  const path = editor.api.findPath(element);
  if (path === undefined) {
    return;
  }
  const meta = parseFormulaMeta(stringProp(element, "meta"));
  const targets =
    meta.id === undefined || meta.id === ""
      ? [[element, path] satisfies NodeEntry<TElement>]
      : formulaEntriesById(editor, meta.id);
  editor.tf.withoutNormalizing(() => {
    for (const [, at] of targets) {
      setFormulaPill(editor, at, props);
    }
  });
};

export const convertFormulaToText = (editor: SlateEditor, element: TElement): void => {
  const path = editor.api.findPath(element);
  if (path === undefined) {
    return;
  }
  const text = entryTextOf(element);
  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at: path });
    editor.tf.insertNodes({ text }, { at: path, select: true });
  });
};

export const FormulaEditForm = ({ element, onDone }: { element: TElement; onDone: () => void }) => {
  const editor = useEditorRef();
  const [entry, setEntry] = useState(() => entryTextOf(element));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const props = formulaPropsFromEntry(entry, { meta: stringProp(element, "meta") ?? "" });
        if (props !== null) {
          applyFormulaEdit(editor, element, props);
        }
        onDone();
      }}
    >
      <input
        aria-label="Edit formula"
        className="w-48 rounded-sm bg-transparent px-1.5 py-0.5 font-mono text-body outline-none"
        value={entry}
        onChange={(event) => {
          setEntry(event.target.value);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
    </form>
  );
};
