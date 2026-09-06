import { useEffect, useRef, useState } from "react";
import { NodeApi, type NodeEntry, type SlateEditor, type TElement } from "platejs";
import { useEditorRef } from "platejs/react";

import { Popover, PopoverContent } from "@repo/ui/components/popover";

import { parseFormulaMeta } from "@repo/notes/formulas/formula-meta";
import {
  entryTextOf,
  formulaPropsFromEntry,
  type FormulaNodeProps,
} from "@repo/editor/formulas/formula-entry";
import { stringProp } from "@repo/editor/node-props";

function formulaEntriesById(editor: SlateEditor, id: string): NodeEntry<TElement>[] {
  const out: NodeEntry<TElement>[] = [];
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: (node) => NodeApi.isNode(node) && "type" in node && node.type === "formulaPill",
  })) {
    const meta = parseFormulaMeta(stringProp(entry[0], "meta"));
    if (meta.id === id) out.push(entry);
  }
  return out;
}

export function applyFormulaEdit(
  editor: SlateEditor,
  element: TElement,
  props: FormulaNodeProps,
): void {
  const path = editor.api.findPath(element);
  if (path === undefined) return;
  const meta = parseFormulaMeta(stringProp(element, "meta"));
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
  anchor,
  onClose,
}: {
  element: TElement;
  anchor: React.RefObject<HTMLElement | null>;
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
    const props = formulaPropsFromEntry(entry, { meta: stringProp(element, "meta") ?? "" });
    if (props !== null) {
      applyFormulaEdit(editor, element, props);
    }
    onClose();
  };

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="start"
        className="w-auto flex-row items-center gap-1 p-1"
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
      </PopoverContent>
    </Popover>
  );
}
