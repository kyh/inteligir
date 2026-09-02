// React-free so the cancel/undo interleavings are testable headlessly. Every
// operation re-resolves the element's path and no-ops when it is gone:
// restoring text over an undo corrupts history.

import { NodeApi, type Path, type SlateEditor, type TElement } from "platejs";

export type ComboboxCancelCause = "arrowLeft" | "arrowRight" | "backspace" | "deselect" | "escape";

function elementPath(editor: SlateEditor, element: TElement): Path | null {
  const path = editor.api.findPath(element);
  return path ?? null;
}

// Keystrokes that landed in the element's text child between the trigger keydown and the input taking focus.
export function racedComboboxText(element: TElement): string {
  return NodeApi.string(element);
}

// Clears it too: left in the document it renders after the input.
export function absorbRacedComboboxText(editor: SlateEditor, element: TElement): string {
  const raced = NodeApi.string(element);
  if (raced.length === 0) return "";
  const path = editor.api.findPath(element);
  if (path) {
    editor.tf.delete({
      at: {
        anchor: { offset: 0, path: [...path, 0] },
        focus: { offset: raced.length, path: [...path, 0] },
      },
      voids: true,
    });
  }
  return raced;
}

// Chromium leaves the caret before an IME-style commit (`Input.insertText`,
// dictation) when it is the first edit after a programmatic focus, so the next
// keystroke lands at offset 0. Answers the caret a native keystroke would have
// produced, or null when the browser's caret already reads as an insertion end.
export function reconcileInsertionCaret(
  previous: string,
  next: string,
  caret: number | null,
): number | null {
  if (caret === null) return null;
  const inserted = next.length - previous.length;
  if (inserted <= 0) return null;
  let prefix = 0;
  while (prefix < previous.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (prefix + suffix < previous.length) return null;
  const lo = previous.length - suffix;
  const hi = prefix;
  if (caret >= lo + inserted && caret <= hi + inserted) return null;
  if (caret >= lo && caret <= hi) return caret + inserted;
  return null;
}

export function commitComboboxInput(
  editor: SlateEditor,
  element: TElement,
  focusEditor: boolean,
): void {
  const path = elementPath(editor, element);
  if (path) editor.tf.removeNodes({ at: path });
  if (focusEditor) editor.tf.focus();
}

export function cancelComboboxInput(
  editor: SlateEditor,
  element: TElement,
  { cause, restoreText }: { cause: ComboboxCancelCause; restoreText: string },
): void {
  const path = elementPath(editor, element);
  if (!path) return;
  // Slate normalization gives inline elements text siblings, so the point before is in the same block.
  const before = editor.api.before(path) ?? editor.api.start(path);
  if (!before) return;
  // a PointRef: the removal merges the flanking text siblings, so a static point goes stale
  const pointRef = editor.api.pointRef(before);
  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at: path });
  });
  const at = pointRef.unref();
  if (!at) return;
  if (cause === "backspace" || restoreText.length === 0) {
    editor.tf.select(at);
    return;
  }
  editor.tf.insertText(restoreText, { at });
  editor.tf.select(
    cause === "arrowLeft" ? at : { offset: at.offset + restoreText.length, path: at.path },
  );
}
