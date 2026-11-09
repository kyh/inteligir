// A picker's input stands in a block while it is open, and a note's live document carries it to
// every editor of the note, its own object's included: each must hold it as the inline void the
// picker's editor made, or its normalizer moves it out of the line and writes that back.

import { createSlatePlugin } from "platejs";
import { BaseSlashInputPlugin } from "@platejs/slash-command";

import { FORMULA_INPUT_KEY } from "@repo/editor/formulas/formula-input-key";

export const formulaInputBasePlugin = createSlatePlugin({
  key: FORMULA_INPUT_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const PickerInputBaseKit = [BaseSlashInputPlugin, formulaInputBasePlugin];
