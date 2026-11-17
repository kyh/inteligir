// A page's words as plain paragraphs, a block's text each: what the article's tree is held to, and
// the article itself where the tree loses words or no parser takes the page. The walk keeps a
// stack of its own and reads either tree the reader holds, hast or the host's DOM, so a page
// nested past any recursion still reads.

import type { Nodes } from "hast";
import type { Paragraph, Root } from "mdast";

import { FILL_LIMITS } from "@repo/contract/items/link-fill";

// elements whose text is never the article's
export const DROPPED: ReadonlySet<string> = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "object",
  "embed",
  "video",
  "audio",
  "canvas",
  "svg",
  "button",
  "form",
  "input",
  "select",
  "textarea",
  "dialog",
  "head",
]);

// elements that end the paragraph the walk is gathering
const BLOCKS: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

// how the walk reads a tree's nodes
export interface TreeReads<Node> {
  readonly children: (node: Node) => Iterable<Node>;
  // an element's name in lower case, null for any other node
  readonly tag: (node: Node) => string | null;
  // a text node's text, null for any other node
  readonly text: (node: Node) => string | null;
}

export const HAST: TreeReads<Nodes> = {
  children: (node) => ("children" in node ? node.children : []),
  tag: (node) => (node.type === "element" ? node.tagName : null),
  text: (node) => (node.type === "text" ? node.value : null),
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export const DOM: TreeReads<Node> = {
  children: (node) => node.childNodes,
  tag: (node) => (node.nodeType === ELEMENT_NODE ? node.nodeName.toLowerCase() : null),
  text: (node) => (node.nodeType === TEXT_NODE ? node.nodeValue : null),
};

const END = Symbol("a block's end");

// the leading paragraphs under a node within the article's budget (FILL_LIMITS.articleBytes), the
// one that would pass it ending the walk
export const wordsOf = <Node>(root: Node, reads: TreeReads<Node>): string[] => {
  const paragraphs: string[] = [];
  let current = "";
  let room: number = FILL_LIMITS.articleBytes;
  const flush = (): void => {
    const text = current.replaceAll(/\s+/gu, " ").trim();
    current = "";
    room -= text.length;
    if (text !== "" && room >= 0) {
      paragraphs.push(text);
    }
  };
  const pending: (Node | typeof END)[] = [...reads.children(root)].toReversed();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (room < 0) {
      break;
    }
    if (node === END) {
      flush();
      continue;
    }
    current += reads.text(node) ?? "";
    const tag = reads.tag(node);
    if (tag === null || DROPPED.has(tag)) {
      continue;
    }
    if (BLOCKS.has(tag)) {
      flush();
      pending.push(END);
    }
    pending.push(...[...reads.children(node)].toReversed());
  }
  flush();
  return paragraphs;
};

export const plainParagraph = (value: string): Paragraph => ({
  children: [{ type: "text", value }],
  type: "paragraph",
});

// paragraphs as the tree the editor reads, each a paragraph of plain text
export const paragraphsTree = (paragraphs: readonly string[]): Root => ({
  children: paragraphs.map(plainParagraph),
  type: "root",
});
