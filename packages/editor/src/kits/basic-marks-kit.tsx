// Autoformat rides each plugin's `inputRules`; @platejs/autoformat is an inert stub.
// Underline has no GFM form, so no input rule applies it; ⌘U and the touch toolbar do, and a save
// writes it as `<u>…</u>`.

import {
  BoldRules,
  CodeRules,
  ItalicRules,
  MarkComboRules,
  StrikethroughRules,
} from "@platejs/basic-nodes";
import {
  BoldPlugin,
  CodePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";

import { KEYS } from "platejs";

import { semanticLeaf } from "@repo/editor/kits/kit-utils";
import { markPluginShortcuts } from "@repo/editor/mark-shortcuts";

// chords come from MARK_SHORTCUTS, never Plate's own defaults, so the page that lists them is true
export const BasicMarksKit = [
  BoldPlugin.configure({
    inputRules: [BoldRules.markdown(), MarkComboRules.markdown({ variant: "boldItalic" })],
    shortcuts: markPluginShortcuts(KEYS.bold),
  }).withComponent(semanticLeaf("strong")),
  ItalicPlugin.configure({
    inputRules: [ItalicRules.markdown(), ItalicRules.markdown({ variant: "_" })],
    shortcuts: markPluginShortcuts(KEYS.italic),
  }).withComponent(semanticLeaf("em")),
  UnderlinePlugin.configure({ shortcuts: markPluginShortcuts(KEYS.underline) }).withComponent(
    semanticLeaf("u"),
  ),
  StrikethroughPlugin.configure({
    inputRules: [StrikethroughRules.markdown()],
  }).withComponent(semanticLeaf("s")),
  CodePlugin.configure({
    inputRules: [CodeRules.markdown()],
  }).withComponent(semanticLeaf("code", "whitespace-pre-wrap")),
];
