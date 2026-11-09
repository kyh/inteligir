// Markdown read into the editor's value as its own export would read back: an embed of a file
// (`![[shot.png|300]]`) made the image the rule table reads `![|300](path)` as, so the parse lifts
// it into a block of its own as it lifts every markdown image, then the value written and read
// again until its bytes hold still, so a file a person wrote by hand reads as the value its own
// export reads back as.

import type { RootContent } from "mdast";
import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";

import { WIKI_EMBED_KEY } from "@repo/editor/dialect-node-keys";
import { headlessEditor, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { mdToSlate, withinStack } from "@repo/editor/markdown/md-to-slate";
import { wikiFieldsOf, wikiPartsOf } from "@repo/editor/wiki/wiki-node";
import { mdLinkUrl } from "@repo/editor/knowledge/link-extract";

import type { ReadPorts } from "./read-blocks";
import { leaf } from "./slate-leaves";

// how many times a value is written and read again before it holds still: a churn-class
// construct settles on its first write, the slowest the editor's fixtures know on its second
const SETTLE_PASSES = 2;

export const elementsOf = (nodes: readonly Descendant[]): TElement[] =>
  nodes.filter((node): node is TElement => ElementApi.isElement(node));

const embedImage = (node: TElement, ports: ReadPorts): Descendant => {
  const fields = wikiFieldsOf(node);
  const reached = ports.wiki(wikiPartsOf(fields), true);
  if (reached?.kind !== "file") {
    return node;
  }
  const width = /^\d{1,5}(?:x\d{1,5})?$/u.test(fields.alias ?? "") ? `|${fields.alias ?? ""}` : "";
  return {
    caption: [leaf(width, {})],
    children: [leaf("", {})],
    type: "img",
    url: mdLinkUrl(reached.file.path),
  };
};

// every embed of a file as the image that embeds it by address
export const embedFiles = (nodes: readonly Descendant[], ports: ReadPorts): Descendant[] =>
  nodes.map((node) => {
    if (!ElementApi.isElement(node)) {
      return node;
    }
    if (node.type === WIKI_EMBED_KEY) {
      return embedImage(node, ports);
    }
    return { ...node, children: embedFiles(node.children, ports) };
  });

// a value as writing it and reading it back would leave it; `read` is what its own reading took
// out of the tree beyond the grammar, which the written bytes spell again
export const settled = (
  value: TElement[],
  read?: (flow: RootContent[]) => RootContent[],
): TElement[] => {
  if (value.length === 0) {
    return value;
  }
  const editor = headlessEditor();
  let current = value;
  withinStack(() => {
    let written = serializeNote(editor, current);
    for (let pass = 0; pass < SETTLE_PASSES; pass += 1) {
      const back = mdToSlate(editor, written, read);
      if (!back.ok) {
        return;
      }
      current = elementsOf(back.nodes);
      const again = serializeNote(editor, current);
      if (again === written) {
        return;
      }
      written = again;
    }
  });
  return current;
};
