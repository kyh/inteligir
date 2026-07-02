// Basic blocks kit. Base half feeds the headless serialization mirror; the
// React half adds the styled block components (paragraph/headings relocated
// from markdown-editor.tsx, blockquote/hr from src/editor/nodes/) plus the
// md-representable autoformat input rules (`# `→h1 … `> `→quote, `---`→hr).

import {
  BaseBlockquotePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseHorizontalRulePlugin,
  BlockquoteRules,
  HeadingRules,
  HorizontalRuleRules,
} from "@platejs/basic-nodes";
import {
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
} from "@platejs/basic-nodes/react";
import { ParagraphPlugin, PlateElement, type PlateElementProps } from "platejs/react";

import { BlockquoteElement } from "@repo/app/editor/nodes/blockquote-node";
import { HrElement } from "@repo/app/editor/nodes/hr-node";

export const BasicBlocksBaseKit = [
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseBlockquotePlugin,
  BaseHorizontalRulePlugin,
];

// className-only element renderers (Plate plugins ship headless).
function element(as: keyof HTMLElementTagNameMap, className: string) {
  return function Element(props: PlateElementProps) {
    return <PlateElement {...props} as={as} className={className} />;
  };
}

// Heading margins/sizes match the previous EDITOR_COMPONENTS styling.
function heading(as: "h1" | "h2" | "h3", top: string, size: string) {
  return element(
    as,
    `relative ${top} mb-1 px-0.5 py-[3px] ${size} font-semibold leading-[1.3] first:mt-0`,
  );
}

export const BasicBlocksKit = [
  ParagraphPlugin.withComponent(element("p", "px-0.5 py-[3px]")),
  H1Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(
    heading("h1", "mt-8", "text-[1.875em]"),
  ),
  H2Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(
    heading("h2", "mt-[1.4em]", "text-[1.5em]"),
  ),
  H3Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(
    heading("h3", "mt-[1em]", "text-[1.25em]"),
  ),
  BlockquotePlugin.configure({ inputRules: [BlockquoteRules.markdown()] }).withComponent(
    BlockquoteElement,
  ),
  HorizontalRulePlugin.configure({ inputRules: [HorizontalRuleRules.markdown()] }).withComponent(
    HrElement,
  ),
];
