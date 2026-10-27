// Markdown read into the editor's value the way a person's first rich save would leave it: an
// embed of a file (`![[shot.png|300]]`) made the image the rule table reads `![|300](path)` as,
// so the parse lifts it into a block of its own as it lifts every markdown image, then the value
// written and read again until its bytes hold still, so a file a person wrote by hand reads as the
// value its own export reads back as.

import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";

import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

import { headlessEditor, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { mdToSlate } from "@repo/editor/markdown/md-to-slate";
import { stringProp } from "@repo/editor/node-props";

import type { ReadPorts } from "./read-blocks";
import { leaf } from "./slate-leaves";

// how many times a value is written and read again before it holds still: a churn-class
// construct settles on its first save, the slowest the editor's fixtures know on its second
const SETTLE_PASSES = 2;

export const elementsOf = (nodes: readonly Descendant[]): TElement[] =>
  nodes.filter((node): node is TElement => ElementApi.isElement(node));

const embedImage = (node: TElement, ports: ReadPorts): Descendant => {
  const link = parseWikiBody(stringProp(node, "body") ?? "");
  const reached = ports.wiki(link, true);
  if (reached?.kind !== "file") {
    return node;
  }
  const width = /^\d{1,5}(?:x\d{1,5})?$/u.test(link.alias ?? "") ? `|${link.alias ?? ""}` : "";
  return {
    caption: [leaf(width, {})],
    children: [leaf("", {})],
    type: "img",
    url: reached.file.path,
  };
};

// every embed of a file as the image that embeds it by address
export const embedFiles = (nodes: readonly Descendant[], ports: ReadPorts): Descendant[] =>
  nodes.map((node) => {
    if (!ElementApi.isElement(node)) {
      return node;
    }
    if (node.type === "wikiEmbed") {
      return embedImage(node, ports);
    }
    return { ...node, children: embedFiles(node.children, ports) };
  });

// a value as a rich save of it would leave it
export const settled = (value: TElement[]): TElement[] => {
  if (value.length === 0) {
    return value;
  }
  const editor = headlessEditor();
  let current = value;
  try {
    let written = serializeNote(editor, current);
    for (let pass = 0; pass < SETTLE_PASSES; pass += 1) {
      const read = mdToSlate(editor, written);
      if (!read.ok) {
        return current;
      }
      current = elementsOf(read.nodes);
      const again = serializeNote(editor, current);
      if (again === written) {
        return current;
      }
      written = again;
    }
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
  }
  return current;
};
