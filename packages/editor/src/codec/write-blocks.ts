// The persisted vocabulary spelled for the rule table (`md-rules.ts`), which already writes the
// vocabulary's own nodes, so an item leaves in the editor's own spelling. What this pass
// spells is what the library holds by id and markdown names by words: a page link under its item's
// live title (the rule table writes `[Title](mention:<id>)`), and a file the library holds by its
// bytes at the path the caller gives it.

import type { Descendant, TElement, TText } from "platejs";

import type { LibraryBlock, LibraryNode } from "@repo/contract/library/library-nodes";

import { INLINE_TYPES } from "./read-blocks";
import { isText, leaf, marksOf, tidyInlines } from "./slate-leaves";
import type { Marks } from "./slate-leaves";

// a file the library holds by its bytes, as one block names it
export interface WrittenFile {
  readonly sha: string;
  readonly node: "img" | "file" | "video";
  // the name a file block shows
  readonly name: string | null;
}

export interface WritePorts {
  // the target a link to this item is spelled with; null when the item is gone, and the link keeps
  // the title it saw
  readonly target: (itemId: string) => string | null;
  // where a file's bytes are written
  readonly path: (file: WrittenFile) => string;
}

// the marks laid across a void, which its one leaf carries
const voidMarks = (node: { children: readonly TText[] }): Marks =>
  node.children[0] === undefined ? {} : marksOf(node.children[0]);

const voidLeaf = (node: { children: readonly TText[] }): TText[] => [leaf("", voidMarks(node))];

// the list depth a block nested under an item keeps, which a rebuilt block carries over
const indentOf = (node: { indent?: number | undefined }): { indent?: number } =>
  node.indent === undefined ? {} : { indent: node.indent };

type Element<T extends string> = Extract<LibraryNode, { type: T }>;

// a page link under its item's live title; a link to an item gone keeps the title it saw
const spellMention = (node: Element<"mention">, ports: WritePorts): TElement => ({
  children: voidLeaf(node),
  key: node.key,
  type: "mention",
  value: ports.target(node.key) ?? node.value,
});

// an image's caption is its alt, and an Obsidian `|width` after it keeps the width
const writeImage = (node: Element<"img">, ports: WritePorts): TElement => {
  const url = node.url ?? ports.path({ name: null, node: "img", sha: node.sha ?? "" });
  const caption: TText[] = (node.caption ?? []).map((part) => ({ ...part }));
  if (node.width !== undefined) {
    caption.push(leaf(`|${String(node.width)}`, {}));
  }
  const image: TElement = {
    caption: tidyInlines(caption).filter((part): part is TText => isText(part)),
    children: voidLeaf(node),
    type: "img",
    url,
    ...indentOf(node),
  };
  if (node.title !== undefined) {
    image.title = node.title;
  }
  return image;
};

// a file the library holds is written as `![](path)`, which reads back as that file's block
const writeFileBlock = (node: Element<"file"> | Element<"video">, ports: WritePorts): TElement => {
  if (node.url !== undefined) {
    return { children: voidLeaf(node), type: node.type, url: node.url, ...indentOf(node) };
  }
  const name = node.type === "file" ? (node.name ?? null) : null;
  const url = ports.path({ name, node: node.type, sha: node.sha ?? "" });
  return {
    caption: [leaf("", {})],
    children: voidLeaf(node),
    type: "img",
    url,
    ...indentOf(node),
  };
};

const writeNode = (node: LibraryNode, ports: WritePorts): Descendant => {
  if ("text" in node) {
    return { ...node };
  }
  switch (node.type) {
    case "mention": {
      return spellMention(node, ports);
    }
    case "img": {
      return writeImage(node, ports);
    }
    case "file":
    case "video": {
      return writeFileBlock(node, ports);
    }
    default: {
      const children = node.children.map((child) => writeNode(child, ports));
      const inline = children.every((child) => isText(child) || INLINE_TYPES.has(child.type));
      return { ...node, children: inline ? tidyInlines(children) : children };
    }
  }
};

// blocks as the editor's value, ready for the rule table
export const writeBlocks = (blocks: readonly LibraryBlock[], ports: WritePorts): TElement[] =>
  blocks.flatMap((block) => {
    const written = writeNode(block, ports);
    return isText(written) ? [] : [written];
  });
