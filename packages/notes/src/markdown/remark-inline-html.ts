// htmlFlow is disabled: its type-6 and type-7 branches swallow every line up to a blank one, so a
// `<div>x</div>` would eat the `:::` closing the container it sits in. Every tag is htmlText inside
// a paragraph, then, and a tag and the closer that ends it among the same siblings fold into one
// node while the tree compiles, so the knowledge scan pairs them exactly as the editor does: a
// bare `<u>` is the underline mark, any other pair one element the editor carries as its source.
// A tag nothing closes stays the `html` node it was.

// remark-stringify's augmentation declares `Data.toMarkdownExtensions` (types-only).
/// <reference types="remark-stringify" />

import type { Html, Nodes, Parent, Parents, PhrasingContent, Root } from "mdast";
import type { Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type { Info, Options as ToMarkdownExtension, State } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";

export interface Underline extends Parent {
  type: "underline";
  children: PhrasingContent[];
}

// the tags as written, around what they enclose
export interface HtmlElement extends Parent {
  type: "htmlElement";
  open: Html;
  close: Html;
  children: PhrasingContent[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    htmlElement: HtmlElement;
    underline: Underline;
  }
  interface RootContentMap {
    htmlElement: HtmlElement;
    underline: Underline;
  }
}

const UNDERLINE_OPEN = "<u>";
const UNDERLINE_CLOSE = "</u>";

// micromark has already read each value as an html tag, so these only tell its kinds apart; a
// comment, a declaration or an instruction is neither.
const OPENER = /^<(?<name>[A-Za-z][\dA-Za-z-]*)(?:[\s/][^]*)?>$/u;
const CLOSER = /^<\/(?<name>[A-Za-z][\dA-Za-z-]*)\s*>$/u;

const openerName = (html: Html): string | null =>
  html.value.endsWith("/>") ? null : (OPENER.exec(html.value)?.groups?.name ?? null);

const closerName = (html: Html): string | null => CLOSER.exec(html.value)?.groups?.name ?? null;

const fold = (open: Html, children: PhrasingContent[], close: Html): Underline | HtmlElement => {
  const node: Underline | HtmlElement =
    open.value === UNDERLINE_OPEN && close.value === UNDERLINE_CLOSE
      ? { children, type: "underline" }
      : { children, close, open, type: "htmlElement" };
  const start = open.position?.start;
  const end = close.position?.end;
  if (start !== undefined && end !== undefined) {
    node.position = { end, start };
  }
  return node;
};

interface OpenTag {
  name: string;
  node: Html;
  // where the opener sits in the folded run
  at: number;
}

// a closer pairs with the innermost opener of its name; an opener it passes over stays html.
const pairTags = (children: PhrasingContent[]): PhrasingContent[] => {
  const folded: PhrasingContent[] = [];
  const open: OpenTag[] = [];
  for (const child of children) {
    if (child.type === "html") {
      const closing = closerName(child);
      const depth = closing === null ? -1 : open.findLastIndex((tag) => tag.name === closing);
      const opener = open[depth];
      if (opener !== undefined) {
        open.length = depth;
        const inner = folded.splice(opener.at).slice(1);
        folded.push(fold(opener.node, inner, child));
        continue;
      }
      const name = closing === null ? openerName(child) : null;
      if (name !== null) {
        open.push({ at: folded.length, name, node: child });
      }
    }
    folded.push(child);
  }
  return folded;
};

type PhrasingParent = Extract<Nodes, { children: PhrasingContent[] }>;

const PHRASING_PARENTS: ReadonlySet<string> = new Set<PhrasingParent["type"]>([
  "delete",
  "emphasis",
  "heading",
  "htmlElement",
  "link",
  "linkReference",
  "paragraph",
  "strong",
  "tableCell",
  "underline",
]);

const isPhrasingParent = (node: Nodes): node is PhrasingParent => PHRASING_PARENTS.has(node.type);

const visit = (node: Nodes): void => {
  if (!("children" in node)) {
    return;
  }
  for (const child of node.children) {
    visit(child);
  }
  if (isPhrasingParent(node)) {
    node.children = pairTags(node.children);
  }
};

const pairTagsInTree = (tree: Root): undefined => {
  visit(tree);
};

const inlineHtmlFromMarkdown: FromMarkdownExtension = { transforms: [pairTagsInTree] };

const between = (
  open: string,
  node: Underline | HtmlElement,
  close: string,
  state: State,
  info: Info,
): string => {
  const tracker = state.createTracker(info);
  let value = tracker.move(open);
  value += tracker.move(
    state.containerPhrasing(node, { ...tracker.current(), after: "<", before: value }),
  );
  value += tracker.move(close);
  return value;
};

const peek = (): string => "<";

const inlineHtmlToMarkdown: ToMarkdownExtension = {
  handlers: {
    htmlElement: Object.assign(
      (node: HtmlElement, _parent: Parents | undefined, state: State, info: Info) =>
        between(node.open.value, node, node.close.value, state, info),
      { peek },
    ),
    underline: Object.assign(
      (node: Underline, _parent: Parents | undefined, state: State, info: Info) =>
        between(UNDERLINE_OPEN, node, UNDERLINE_CLOSE, state, info),
      { peek },
    ),
  },
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkInlineHtml: Plugin = function remarkInlineHtml(this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ disable: { null: ["htmlFlow"] } });
  (data.fromMarkdownExtensions ??= []).push(inlineHtmlFromMarkdown);
  (data.toMarkdownExtensions ??= []).push(inlineHtmlToMarkdown);
};
