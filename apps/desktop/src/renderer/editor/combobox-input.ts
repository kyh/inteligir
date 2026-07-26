// The inline combobox's editor-mutation core, React-free so the crash-prone
// paths (cancel restore + undo/redo interleaving) are pinned by headless
// regression tests (inline-combobox.test.ts).
//
// Invariants:
// - Every operation re-resolves the trigger element's path at call time. If
//   the element is already gone (an undo/redo or external edit removed it),
//   the call is a no-op: history owns those bytes, and restoring text on top
//   of an undo is exactly the corruption/crash class this module exists to
//   prevent.
// - The restore point is captured as a live PointRef across the removal (the
//   removal merges the element's flanking text siblings, so a static point's
//   path goes stale mid-cancel).
// - Remove + restore happen in one withoutNormalizing block within one tick,
//   so undo/redo treat a cancel as an atomic step.

import { NodeApi, type Path, type SlateEditor, type TElement } from "platejs";

export type ComboboxCancelCause = "arrowLeft" | "arrowRight" | "backspace" | "deselect" | "escape";

function elementPath(editor: SlateEditor, element: TElement): Path | null {
  const path = editor.api.findPath(element);
  return path ?? null;
}

/**
 * Text that landed inside the trigger element's hidden text child during the
 * insert→focus race window (keystrokes between the trigger keydown and the
 * HTML input receiving focus). The input absorbs it into its value; the
 * bytes leave the document when the element is removed on commit/cancel.
 */
export function racedComboboxText(element: TElement): string {
  return NodeApi.string(element);
}

/**
 * Read AND clear the raced text (it renders after the input otherwise —
 * visible reordering). Returns the absorbed text; the caller prepends it to
 * the input value. Safe when the element is already gone.
 */
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

/**
 * Chromium leaves the caret BEFORE the text of an IME-style commit
 * (`Input.insertText` automation, dictation) when it is the first edit after
 * the input was focused programmatically — the next keystroke then lands at
 * offset 0 and "deep" assembles as "eepd". Given the input's
 * previous value, its new value, and the caret the browser reported, return
 * the caret a native keystroke would have produced — or null when the
 * browser's caret is already consistent (never fight a correct browser).
 *
 * Detection: a value change that is a single inserted run has a (possibly
 * ambiguous, when the run repeats neighboring characters) interval of valid
 * insertion positions. A caret that can only be read as an insertion START —
 * never as an insertion END — is the quirk; anything else is left alone.
 */
export function reconcileInsertionCaret(
  previous: string,
  next: string,
  caret: number | null,
): number | null {
  if (caret === null) return null;
  const inserted = next.length - previous.length;
  if (inserted <= 0) return null; // deletion or no-op — not an insertion
  let prefix = 0;
  while (prefix < previous.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (prefix + suffix < previous.length) return null; // not a single run
  const lo = previous.length - suffix;
  const hi = prefix;
  if (caret >= lo + inserted && caret <= hi + inserted) return null; // consistent
  if (caret >= lo && caret <= hi) return caret + inserted; // stranded before the run
  return null; // unrelated caret — don't touch
}

/**
 * Commit path: remove the trigger element (the selected item's own action
 * inserts content afterwards). Safe when the element is already gone.
 */
export function commitComboboxInput(
  editor: SlateEditor,
  element: TElement,
  focusEditor: boolean,
): void {
  const path = elementPath(editor, element);
  if (path) editor.tf.removeNodes({ at: path });
  if (focusEditor) editor.tf.focus();
}

/**
 * Cancel path: remove the trigger element and restore `restoreText` (trigger
 * char + typed query) where the trigger was typed — except on backspace,
 * which deletes the trigger too. The caret lands after the restored text
 * (before it for arrowLeft, matching the "step out to the left" gesture).
 */
export function cancelComboboxInput(
  editor: SlateEditor,
  element: TElement,
  { cause, restoreText }: { cause: ComboboxCancelCause; restoreText: string },
): void {
  const path = elementPath(editor, element);
  if (!path) return; // removed externally — nothing to restore
  // Inline elements always carry text siblings (Slate normalization), so the
  // point directly before the element is inside the same block.
  const before = editor.api.before(path) ?? editor.api.start(path);
  if (!before) return;
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
