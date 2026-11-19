import { createSlatePlugin } from "platejs";
import { BaseSlashInputPlugin } from "@platejs/slash-command";

import { FORMULA_INPUT_KEY } from "@repo/editor/headless/formulas/formula-input-key";

export const formulaInputBasePlugin = createSlatePlugin({
  key: FORMULA_INPUT_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const PickerInputBaseKit = [BaseSlashInputPlugin, formulaInputBasePlugin];
