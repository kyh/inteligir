// Inline constructs: formula/variable pills and comment anchors, as
// inline-void nodes over the dialect @repo/notes/markdown/remark-inline-constructs
// owns (that file states the round-trip contract and the grammar).
//
//   {{source|display|meta}}  → formulaPill   — a computed pill: display half
//     first (the persisted result), source as the fallback. Click edits over
//     the entry grammar; Backspace on a selected pill converts it back to
//     text; typing `{{…}}` completes a pill (the wiki `]]` rule's sibling);
//     `stale=1` metadata renders an amber hint. Evaluation itself lives in
//     formulas/formula-recompute.ts.
//   %%i:ids:start/end%%      → commentMarker — an anchored-comment
//     boundary. Renders nothing visible: the marker is plumbing for the
//     comment surface (#583), and drawing brackets in prose would put the
//     mechanism where the annotation belongs. The bytes stay exact.

import { useState } from "react";
import {
  KEYS,
  createSlatePlugin,
  NodeApi,
  TextApi,
  type SlateEditor,
  type TElement,
} from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { parseFormulaRaw } from "@repo/notes/markdown/remark-inline-constructs";
import { parseFormulaMeta } from "@repo/notes/formulas/formula-meta";
import { cn } from "@repo/ui/lib/utils";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { convertFormulaToText, FormulaEditPopover } from "@repo/editor/formulas/formula-edit";
import { formulaPropsFromEntry, formulaNodeFrom } from "@repo/editor/formulas/formula-entry";

const formulaPillBasePlugin = createSlatePlugin({
  key: "formulaPill",
  node: { isElement: true, isInline: true, isVoid: true },
});

const commentMarkerBasePlugin = createSlatePlugin({
  key: "commentMarker",
  node: { isElement: true, isInline: true, isVoid: true },
});

export const InlineConstructsBaseKit = [formulaPillBasePlugin, commentMarkerBasePlugin];

function formulaLabel(element: PlateElementProps["element"]): string {
  const display = typeof element.display === "string" ? element.display : "";
  if (display !== "") return display;
  return typeof element.source === "string" ? element.source : "";
}

function FormulaPillElement(props: PlateElementProps) {
  const [editing, setEditing] = useState(false);
  const meta = parseFormulaMeta(
    typeof props.element.meta === "string" && props.element.meta !== ""
      ? props.element.meta
      : undefined,
  );
  return (
    <PlateElement {...props} as="span" className="relative inline-block">
      <span
        contentEditable={false}
        role="button"
        tabIndex={-1}
        title={
          meta.stale
            ? "Stale: a referenced variable is missing or cyclic"
            : typeof props.element.source === "string"
              ? props.element.source
              : ""
        }
        className={cn(
          "cursor-pointer rounded-sm bg-accent px-1 font-medium text-accent-foreground tabular-nums",
          meta.stale && "underline decoration-amber-500 decoration-dotted underline-offset-2",
        )}
        onClick={() => {
          setEditing(true);
        }}
      >
        {formulaLabel(props.element)}
      </span>
      {editing ? (
        <FormulaEditPopover
          element={props.element}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
      {props.children}
    </PlateElement>
  );
}

function CommentMarkerElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span contentEditable={false} aria-hidden className="sr-only" />
      {props.children}
    </PlateElement>
  );
}

// This keystroke's `}` completes `{{body}}` (the buffer already holds
// `{{body}`). A body carrying pipes is the PERSISTED grammar and completes
// verbatim; a pipeless body runs the entry grammar — and a non-executable
// anonymous entry stays literal text, exactly as typed.
const FORMULA_COMPLETION_RE = /\{\{([^{}\n]+)\}$/u;

function completeFormulaPill(editor: SlateEditor): boolean {
  if (!editor.selection || !editor.api.isCollapsed()) return false;
  if (editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } })) return false;
  const { anchor } = editor.selection;
  const leaf = NodeApi.get(editor, anchor.path);
  if (!leaf || !TextApi.isText(leaf)) return false;
  const match = FORMULA_COMPLETION_RE.exec(leaf.text.slice(0, anchor.offset));
  if (!match) return false;
  const [full, body] = match;
  if (body === undefined || body === "") return false;
  const props = body.includes("|")
    ? { ...parseFormulaRaw(body), raw: body }
    : formulaPropsFromEntry(body);
  if (props === null) return false;
  editor.tf.withoutNormalizing(() => {
    editor.tf.delete({
      at: {
        anchor: { offset: anchor.offset - full.length, path: anchor.path },
        focus: anchor,
      },
    });
  });
  insertVoidAndEscape(
    editor,
    formulaNodeFrom({
      display: props.display,
      meta: "meta" in props ? (props.meta ?? "") : "",
      raw: props.raw,
      source: props.source,
    }),
  );
  return true;
}

/** The pill the caret sits inside (Slate parks a selected inline void's caret
 * in its empty text child), or null. */
function selectedFormula(editor: SlateEditor) {
  if (!editor.selection || !editor.api.isCollapsed()) return null;
  const entry = editor.api.above<TElement>({
    at: editor.selection,
    match: (node) => NodeApi.isNode(node) && "type" in node && node.type === "formulaPill",
  });
  return entry ?? null;
}

export const InlineConstructsKit = [
  formulaPillBasePlugin
    .withComponent(FormulaPillElement)
    .overrideEditor(({ editor, tf: { insertText, deleteBackward } }) => ({
      transforms: {
        deleteBackward(unit) {
          const entry = selectedFormula(editor);
          const node = entry?.[0];
          if (node !== undefined && "type" in node && node.type === "formulaPill") {
            convertFormulaToText(editor, node);
            return;
          }
          deleteBackward(unit);
        },
        insertText(text, options) {
          if (text === "}" && completeFormulaPill(editor)) return;
          insertText(text, options);
        },
      },
    })),
  commentMarkerBasePlugin.withComponent(CommentMarkerElement),
];
