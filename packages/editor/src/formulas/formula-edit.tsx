// Pill interactions: click opens an edit popover over the entry grammar
// (`sum=2+2` / `2+2` / `time=9am`); saving rewrites EVERY linked instance
// (same id in this note — the skill's linked-instance rule); Backspace on a
// selected pill converts it back to its entry text, exactly the spec's
// escape hatch. Everything is an editor transaction — bytes only ever move
// through the serialize path.

import { useEffect, useRef, useState } from "react";
import { NodeApi, type NodeEntry, type SlateEditor, type TElement } from "platejs";
import { useEditorRef } from "platejs/react";

import { parseFormulaMeta } from "@repo/notes/formulas/formula-meta";
import {
  entryTextOf,
  formulaPropsFromEntry,
  type FormulaNodeProps,
} from "@repo/editor/formulas/formula-entry";

function formulaEntriesById(editor: SlateEditor, id: string): NodeEntry<TElement>[] {
  const out: NodeEntry<TElement>[] = [];
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: (node) => NodeApi.isNode(node) && "type" in node && node.type === "mossFormula",
  })) {
    const meta = parseFormulaMeta(
      typeof entry[0].meta === "string" && entry[0].meta !== "" ? entry[0].meta : undefined,
    );
    if (meta.id === id) out.push(entry);
  }
  return out;
}

/** Rewrite the clicked pill — and, when it carries an id, every linked
 * instance in the note with it. */
export function applyFormulaEdit(
  editor: SlateEditor,
  element: TElement,
  props: FormulaNodeProps,
): void {
  const path = editor.api.findPath(element);
  if (path === undefined) return;
  const meta = parseFormulaMeta(
    typeof element.meta === "string" && element.meta !== "" ? element.meta : undefined,
  );
  const targets =
    meta.id === undefined || meta.id === ""
      ? [[element, path] satisfies NodeEntry<TElement>]
      : formulaEntriesById(editor, meta.id);
  editor.tf.withoutNormalizing(() => {
    for (const [, at] of targets) {
      editor.tf.setNodes({ ...props }, { at });
    }
  });
}

/** Replace a pill with its entry text (the spec's Backspace conversion). */
export function convertFormulaToText(editor: SlateEditor, element: TElement): void {
  const path = editor.api.findPath(element);
  if (path === undefined) return;
  const text = entryTextOf(element);
  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at: path });
    editor.tf.insertNodes({ text }, { at: path, select: true });
  });
}

export function FormulaEditPopover({
  element,
  onClose,
}: {
  element: TElement;
  onClose: () => void;
}) {
  const editor = useEditorRef();
  const [entry, setEntry] = useState(() => entryTextOf(element));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const save = (): void => {
    const props = formulaPropsFromEntry(entry, {
      meta: typeof element.meta === "string" ? element.meta : "",
    });
    if (props !== null) {
      applyFormulaEdit(editor, element, props);
    }
    onClose();
  };

  return (
    <span
      contentEditable={false}
      className="absolute top-full left-0 z-40 mt-1 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md"
    >
      <input
        ref={inputRef}
        aria-label="Edit formula"
        className="w-48 rounded-sm bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none"
        value={entry}
        onChange={(event) => {
          setEntry(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        onBlur={onClose}
      />
    </span>
  );
}
