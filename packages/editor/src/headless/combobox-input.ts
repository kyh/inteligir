import { KEYS, NodeApi, createSlatePlugin } from "platejs";
import type { SlateEditor, TElement } from "platejs";

import { FORMULA_INPUT_KEY } from "@repo/editor/headless/formulas/formula-input-key";

export const PICKER_INPUT_TYPES: readonly string[] = [
  KEYS.slashInput,
  KEYS.mentionInput,
  FORMULA_INPUT_KEY,
];

export type ComboboxCancelCause = "arrowLeft" | "arrowRight" | "backspace" | "deselect" | "escape";

const elementPath = (editor: SlateEditor, element: TElement) => {
  const path = editor.api.findPath(element);

  return path ?? null;
};

export const PickerRaceKit = [
  createSlatePlugin({ key: "pickerRacedKeys" }).overrideEditor(
    ({ editor, tf: { insertText } }) => ({
      transforms: {
        insertText(text, options) {
          const raced =
            options?.at === undefined &&
            editor.api.some({ match: { type: [...PICKER_INPUT_TYPES] } });

          insertText(text, raced ? { ...options, voids: true } : options);
        },
      },
    }),
  ),
];

export const racedComboboxText = (element: TElement) => NodeApi.string(element);

export const absorbRacedComboboxText = (editor: SlateEditor, element: TElement) => {
  const raced = NodeApi.string(element);

  if (raced.length === 0) {
    return "";
  }

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
};

export const reconcileInsertionCaret = (previous: string, next: string, caret: number | null) => {
  if (caret === null) {
    return null;
  }

  const inserted = next.length - previous.length;

  if (inserted <= 0) {
    return null;
  }

  let prefix = 0;

  while (prefix < previous.length && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < previous.length &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  if (prefix + suffix < previous.length) {
    return null;
  }

  const lo = previous.length - suffix;
  const hi = prefix;

  if (caret >= lo + inserted && caret <= hi + inserted) {
    return null;
  }

  if (caret >= lo && caret <= hi) {
    return caret + inserted;
  }

  return null;
};

export const commitComboboxInput = (
  editor: SlateEditor,
  element: TElement,
  focusEditor: boolean,
) => {
  const path = elementPath(editor, element);

  if (path) {
    editor.tf.removeNodes({ at: path });
  }

  if (focusEditor) {
    editor.tf.focus();
  }
};

export const consumeTriggerLead = (editor: SlateEditor, char: string) => {
  const { selection } = editor;

  if (!selection || !editor.api.isCollapsed()) {
    return false;
  }

  const lead = editor.api.range("before", selection);

  if (!lead || editor.api.string(lead) !== char) {
    return false;
  }

  editor.tf.delete({ at: lead });

  return true;
};

export const cancelComboboxInput = (
  editor: SlateEditor,
  element: TElement,
  { cause, restoreText }: { cause: ComboboxCancelCause; restoreText: string },
) => {
  const path = elementPath(editor, element);

  if (!path) {
    return;
  }

  const before = editor.api.before(path) ?? editor.api.start(path);

  if (!before) {
    return;
  }

  const pointRef = editor.api.pointRef(before);
  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at: path });
  });
  const at = pointRef.unref();

  if (!at) {
    return;
  }

  if (cause === "backspace" || restoreText.length === 0) {
    editor.tf.select(at);

    return;
  }

  editor.tf.insertText(restoreText, { at });
  editor.tf.select(
    cause === "arrowLeft" ? at : { offset: at.offset + restoreText.length, path: at.path },
  );
};
