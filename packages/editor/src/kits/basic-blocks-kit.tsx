import { BlockquoteRules, HeadingRules, HorizontalRuleRules } from "@platejs/basic-nodes";
import {
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
} from "@platejs/basic-nodes/react";
import { ElementApi, KEYS, createBlockStartInputRule } from "platejs";
import type { TElement } from "platejs";
import { ParagraphPlugin, PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { alertVariantSchema } from "@repo/contract/library/library-nodes";
import type { AlertVariant } from "@repo/contract/library/library-nodes";

import { BlockquoteElement } from "@repo/editor/nodes/blockquote-node";
import { HrElement } from "@repo/editor/nodes/hr-node";
import { stringProp } from "@repo/editor/headless/node-props";

const hostsBlockContent = (element: TElement) => stringProp(element, "listStyleType") !== undefined;

const blockElement = (as: keyof HTMLElementTagNameMap, className: string) =>
  function Element(props: PlateElementProps) {
    return (
      <PlateElement
        {...props}
        as={hostsBlockContent(props.element) ? "div" : as}
        className={className}
      />
    );
  };

const heading = (as: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
  blockElement(as, "relative px-0.5");

const alertInputRule = createBlockStartInputRule<{ alert: AlertVariant }>({
  apply: ({ editor, getBlockEntry }, match) => {
    const line = getBlockEntry()?.[1];
    const quote = line?.at(-1) === 0 ? editor.api.parent(line) : undefined;

    if (
      quote === undefined ||
      !ElementApi.isElement(quote[0]) ||
      quote[0].type !== editor.getType(KEYS.blockquote)
    ) {
      return false;
    }

    editor.tf.delete({ at: match.range });
    editor.tf.setNodes({ alert: match.alert }, { at: quote[1] });

    return true;
  },
  match: /^\[!/u,
  resolveMatch: ({ text }) => {
    const alert = alertVariantSchema.safeParse(text.slice(2).toUpperCase());

    return alert.success ? { alert: alert.data } : undefined;
  },
  trigger: "]",
});

export const BasicBlocksKit = [
  ParagraphPlugin.extend(() => ({ shortcuts: { toggleParagraph: null } })).withComponent(
    blockElement("p", "px-0.5"),
  ),
  H1Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(heading("h1")),
  H2Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(heading("h2")),
  H3Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(heading("h3")),
  H4Plugin.withComponent(heading("h4")),
  H5Plugin.withComponent(heading("h5")),
  H6Plugin.withComponent(heading("h6")),
  BlockquotePlugin.configure({
    inputRules: [BlockquoteRules.markdown(), alertInputRule],
  }).withComponent(BlockquoteElement),
  HorizontalRulePlugin.configure({ inputRules: [HorizontalRuleRules.markdown()] }).withComponent(
    HrElement,
  ),
];
