import type { Nodes } from "hast";
import type { Paragraph, Root } from "mdast";

import { FILL_LIMITS } from "@repo/contract/items/link-fill";

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

export interface TreeReads<Node> {
  readonly children: (node: Node) => Iterable<Node>;
  readonly tag: (node: Node) => string | null;
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

export const wordsOf = <Node>(root: Node, reads: TreeReads<Node>) => {
  const paragraphs: string[] = [];
  let current = "";
  let room: number = FILL_LIMITS.articleBytes;

  const flush = () => {
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

export const plainParagraph = (value: string) =>
  ({
    children: [{ type: "text", value }],
    type: "paragraph",
  }) satisfies Paragraph;

export const paragraphsTree = (paragraphs: readonly string[]) =>
  ({
    children: paragraphs.map(plainParagraph),
    type: "root",
  }) satisfies Root;
