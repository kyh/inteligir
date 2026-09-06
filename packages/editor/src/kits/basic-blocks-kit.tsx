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
import {
  ElementApi,
  KEYS,
  NodeApi,
  TextApi,
  createSlatePlugin,
  type DecoratedRange,
  type Path,
  type SlateEditor,
  type TElement,
} from "platejs";
import {
  ParagraphPlugin,
  PlateElement,
  PlateLeaf,
  type PlateEditor,
  type PlateElementProps,
  type PlateLeafProps,
} from "platejs/react";

import { cn } from "cn";

import { BlockquoteElement, alertMarkerPrefix } from "@repo/editor/nodes/blockquote-node";
import { HrElement } from "@repo/editor/nodes/hr-node";
import { CALLOUT_MARKER, CALLOUT_MARKER_LINE } from "@repo/editor/style-hooks";

export const BasicBlocksBaseKit = [
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseBlockquotePlugin,
  BaseHorizontalRulePlugin,
];

// A `listStyleType` block hosts BlockList's <ul> inside it and a wikiEmbed expands into
// block content; either inside <p>/<h*> is invalid DOM and React logs a nesting error.
function hostsBlockContent(element: TElement): boolean {
  if (element.listStyleType) return true;
  return element.children.some(
    (child) => ElementApi.isElement(child) && child.type === "wikiEmbed",
  );
}

function element(as: keyof HTMLElementTagNameMap, className: string) {
  return function Element(props: PlateElementProps) {
    return (
      <PlateElement
        {...props}
        as={hostsBlockContent(props.element) ? "div" : as}
        className={className}
      />
    );
  };
}

// A first-child paragraph that is exactly an alert marker line collapses while the quote is
// not being edited: the badge already shows every byte, so it would render as a stray blank line.
function isAlertMarkerLine(editor: SlateEditor, element: TElement, path: Path): boolean {
  if (element.children.length !== 1) return false;
  const leaf = element.children[0];
  if (!TextApi.isText(leaf) || !leaf.text.startsWith("[!")) return false;
  const marker = alertMarkerPrefix(leaf.text);
  if (!marker || marker.hidden < leaf.text.length) return false;
  if (path.length === 0 || path.at(-1) !== 0) return false;
  const parent = NodeApi.get(editor, path.slice(0, -1));
  return ElementApi.isElement(parent) && parent.type === editor.getType(KEYS.blockquote);
}

function ParagraphElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as={hostsBlockContent(props.element) ? "div" : "p"}
      className={cn(
        "px-0.5",
        isAlertMarkerLine(props.editor, props.element, props.path) && CALLOUT_MARKER_LINE,
      )}
    />
  );
}

function heading(as: "h1" | "h2" | "h3") {
  return element(as, "relative px-0.5");
}

function CalloutMarkerLeaf(props: PlateLeafProps) {
  return <PlateLeaf {...props} className={cn(CALLOUT_MARKER, "text-muted-foreground")} />;
}

// A decoration, so the marker bytes round-trip untouched; React-half only, so the serialization mirror never sees it.
const CalloutMarkerPlugin = createSlatePlugin({
  key: "calloutMarker",
  node: { isLeaf: true },
  decorate: ({ editor, entry: [node, path] }) => {
    if (!TextApi.isText(node) || !node.text.startsWith("[!")) return undefined;
    if (path.length < 3 || path.at(-1) !== 0 || path.at(-2) !== 0) return undefined;
    const paragraph = NodeApi.get(editor, path.slice(0, -1));
    const quote = NodeApi.get(editor, path.slice(0, -2));
    if (!ElementApi.isElement(paragraph) || paragraph.type !== editor.getType(KEYS.p)) {
      return undefined;
    }
    if (!ElementApi.isElement(quote) || quote.type !== editor.getType(KEYS.blockquote)) {
      return undefined;
    }
    const marker = alertMarkerPrefix(node.text);
    if (!marker) return undefined;
    const range: DecoratedRange & { calloutMarker: true } = {
      anchor: { offset: 0, path },
      calloutMarker: true,
      focus: { offset: marker.hidden, path },
    };
    return [range];
  },
}).withComponent(CalloutMarkerLeaf);

// the trailing paragraph gives the caret a landing spot below the void
export function insertHorizontalRule(editor: PlateEditor): void {
  editor.tf.insertNodes(
    { type: HorizontalRulePlugin.key, children: [{ text: "" }] },
    { select: true },
  );
  editor.tf.insertNodes({ type: editor.getType(KEYS.p), children: [{ text: "" }] });
}

export const BasicBlocksKit = [
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(heading("h1")),
  H2Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(heading("h2")),
  H3Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(heading("h3")),
  BlockquotePlugin.configure({ inputRules: [BlockquoteRules.markdown()] }).withComponent(
    BlockquoteElement,
  ),
  HorizontalRulePlugin.configure({ inputRules: [HorizontalRuleRules.markdown()] }).withComponent(
    HrElement,
  ),
  CalloutMarkerPlugin,
];
