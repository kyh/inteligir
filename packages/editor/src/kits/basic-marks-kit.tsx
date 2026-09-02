// Autoformat rides each plugin's `inputRules`; @platejs/autoformat is an inert stub.
// Underline has no GFM form: no input rule, no toolbar — registered only so legacy marks keep a leaf.

import {
  BaseBoldPlugin,
  BaseCodePlugin,
  BaseItalicPlugin,
  BaseStrikethroughPlugin,
  BaseUnderlinePlugin,
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

import { semanticLeaf } from "@repo/editor/kits/kit-utils";

export const BasicMarksBaseKit = [
  BaseBoldPlugin,
  BaseItalicPlugin,
  BaseUnderlinePlugin,
  BaseStrikethroughPlugin,
  BaseCodePlugin,
];

export const BasicMarksKit = [
  BoldPlugin.configure({
    inputRules: [BoldRules.markdown(), MarkComboRules.markdown({ variant: "boldItalic" })],
  }).withComponent(semanticLeaf("strong")),
  ItalicPlugin.configure({
    inputRules: [ItalicRules.markdown(), ItalicRules.markdown({ variant: "_" })],
  }).withComponent(semanticLeaf("em")),
  UnderlinePlugin.withComponent(semanticLeaf("u")),
  StrikethroughPlugin.configure({
    inputRules: [StrikethroughRules.markdown()],
  }).withComponent(semanticLeaf("s")),
  CodePlugin.configure({
    inputRules: [CodeRules.markdown()],
  }).withComponent(semanticLeaf("code", "whitespace-pre-wrap")),
];
