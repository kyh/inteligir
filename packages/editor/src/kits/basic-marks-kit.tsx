import {
  BoldRules,
  CodeRules,
  HighlightRules,
  ItalicRules,
  MarkComboRules,
  StrikethroughRules,
} from "@platejs/basic-nodes";
import {
  BoldPlugin,
  CodePlugin,
  HighlightPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";

import { KEYS } from "platejs";

import { semanticLeaf } from "@repo/editor/kits/kit-utils";
import { markPluginShortcuts } from "@repo/editor/mark-shortcuts";

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
  HighlightPlugin.configure({
    inputRules: [HighlightRules.markdown()],
    shortcuts: markPluginShortcuts(KEYS.highlight),
  }).withComponent(
    semanticLeaf("mark", "rounded-[2px] bg-amber-200/70 text-inherit dark:bg-amber-300/25"),
  ),
];
