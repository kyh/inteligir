// Basic blocks kit. Base half feeds the headless serialization mirror; the
// React half adds the styled block components (paragraph/headings relocated
// from markdown-editor.tsx, blockquote/hr from src/editor/nodes/) plus the
// md-representable autoformat input rules (`# `→h1 … `> `→quote, `---`→hr)
// and the render-only calloutMarker decoration that hides GitHub-alert
// `[!TYPE]` marker lines behind blockquote-node's variant badge.

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

import { cn } from "@repo/ui/lib/utils";

import { BlockquoteElement, alertMarkerPrefix } from "@renderer/editor/nodes/blockquote-node";
import { HrElement } from "@renderer/editor/nodes/hr-node";

export const BasicBlocksBaseKit = [
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseBlockquotePlugin,
  BaseHorizontalRulePlugin,
];

// A block hosting block-rendering children can't stay a <p>/<h*>: a block
// carrying `listStyleType` hosts BlockList's <ul>/<ol> INSIDE it (list-kit's
// render.belowNodes), and a `wikiEmbed` inline void expands into a
// transclusion CARD of block content (lists, tables, nested divs). Either
// inside <p> is invalid DOM and React logs a nesting error on every affected
// note. Such blocks render as <div> instead; the tag is render-only, bytes
// are pinned by the round-trip fixtures.
function hostsBlockContent(element: TElement): boolean {
  if (element.listStyleType) return true;
  return element.children.some(
    (child) => ElementApi.isElement(child) && child.type === "wikiEmbed",
  );
}

// className-only element renderers (Plate plugins ship headless).
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

// A first-child paragraph that is EXACTLY an alert marker line (`> [!TIP]`
// followed by a blank quote line or nothing) collapses toggle-style while the
// quote isn't being edited — its every byte is already presented by the badge,
// so it would render as a stray blank line. CSS lives in styles.css.
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
        "px-0.5 py-[3px]",
        isAlertMarkerLine(props.editor, props.element, props.path) && "callout-marker-line",
      )}
    />
  );
}

// Heading margins/sizes match the previous EDITOR_COMPONENTS styling.
function heading(as: "h1" | "h2" | "h3", top: string, size: string) {
  return element(
    as,
    `relative ${top} mb-1 px-0.5 py-[3px] ${size} font-semibold leading-[1.3] tracking-tight first:mt-0`,
  );
}

function CalloutMarkerLeaf(props: PlateLeafProps) {
  return <PlateLeaf {...props} className="callout-marker text-muted-foreground" />;
}

// Render-only leaf decoration over the `[!TYPE]` marker (plus its soft break)
// at the head of an alert blockquote. Decorations never touch the document
// model, so the marker bytes round-trip untouched; visibility is driven by
// blockquote-node's `.callout-editing` class (caret inside ⇒ revealed).
// React-half only by design — the BASE_KIT serialization mirror and the
// transclusion static render never see it.
const CalloutMarkerPlugin = createSlatePlugin({
  key: "calloutMarker",
  node: { isLeaf: true },
  decorate: ({ editor, entry: [node, path] }) => {
    if (!TextApi.isText(node) || !node.text.startsWith("[!")) return undefined;
    // Only the first leaf of the first paragraph of a blockquote qualifies.
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

/**
 * Insert a horizontal rule (void divider), then a trailing empty paragraph so
 * the caret has a landing spot below it. Slash-menu insert.
 */
export function insertHorizontalRule(editor: PlateEditor): void {
  editor.tf.insertNodes(
    { type: HorizontalRulePlugin.key, children: [{ text: "" }] },
    { select: true },
  );
  editor.tf.insertNodes({ type: editor.getType(KEYS.p), children: [{ text: "" }] });
}

export const BasicBlocksKit = [
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(
    heading("h1", "mt-8", "text-[22px]"),
  ),
  H2Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(
    heading("h2", "mt-[1.4em]", "text-[16px]"),
  ),
  H3Plugin.configure({ inputRules: [HeadingRules.markdown()] }).withComponent(
    heading("h3", "mt-[1em]", "text-[15px]"),
  ),
  BlockquotePlugin.configure({ inputRules: [BlockquoteRules.markdown()] }).withComponent(
    BlockquoteElement,
  ),
  HorizontalRulePlugin.configure({ inputRules: [HorizontalRuleRules.markdown()] }).withComponent(
    HrElement,
  ),
  CalloutMarkerPlugin,
];
