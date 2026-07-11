// Basic marks kit. Base half feeds the headless serialization mirror; the
// React half adds the styled leaves plus the md-representable autoformat
// input rules (v53 puts autoformat on the owning plugin as `inputRules` —
// the old @platejs/autoformat package is a deprecated inert stub).
//
// Underline has no GFM form, so it gets NO input rule (`__` stays literal) and
// no toolbar surface — the plugin is registered only so legacy content
// carrying the mark doesn't fall to an unstyled leaf. Kept md-representable
// rules: `**bold**`, `*italic*`/`_italic_`, `~~strike~~`, `` `code` ``,
// `***bold-italic***`.

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

import { semanticLeaf } from "@renderer/editor/kits/kit-utils";

export const BasicMarksBaseKit = [
  BaseBoldPlugin,
  BaseItalicPlugin,
  BaseUnderlinePlugin,
  BaseStrikethroughPlugin,
  BaseCodePlugin,
];

// Mark typography comes from typeset (strong/em/s/code :where() rules); the
// renderers only pick the semantic tag.
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
