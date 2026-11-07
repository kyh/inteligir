// The persisted vocabulary spelled for the rule table (`md-rules.ts`), which already writes the
// vocabulary's own nodes, so an item leaves in the editor's own spelling. What this pass
// spells is what the library holds by id and the dialect names by words: a link's target as the
// caller spells it (a file's shortest name in an export, the item's live title in the agent's
// view, with its id after the pipe only there), a file the library holds by its bytes at the path
// the caller gives it, and a block's `ref` as its Obsidian `^ref`.

import type { Descendant, TElement, TText } from "platejs";

import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";

import { WIKI_EMBED_KEY, WIKI_LINK_KEY } from "@repo/editor/dialect-node-keys";
import { wikiNode } from "@repo/editor/wiki/wiki-node";

import { INLINE_REF_TYPES, INLINE_TYPES } from "./read-blocks";
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
  // whether a link carries its item's id after its last pipe (`[[Title|uuid]]`), as the agent's
  // view writes it and an export never does
  readonly withIds: boolean;
  // where a file's bytes are written
  readonly path: (file: WrittenFile) => string;
}

// the marks laid across a void, which its one leaf carries
const voidMarks = (node: { children: readonly TText[] }): Marks =>
  node.children[0] === undefined ? {} : marksOf(node.children[0]);

const voidLeaf = (node: { children: readonly TText[] }): TText[] => [leaf("", voidMarks(node))];

type Element<T extends string> = Extract<LibraryNode, { type: T }>;

// a link or an embed under the name the caller spells its item with; a link to no item keeps the
// title it was written with
const spellWiki = (
  node: Element<"wikiLink"> | Element<"wikiEmbed">,
  ports: WritePorts,
): TElement => {
  const target = (node.itemId === null ? null : ports.target(node.itemId)) ?? node.title;
  return wikiNode(
    node.type === "wikiLink" ? WIKI_LINK_KEY : WIKI_EMBED_KEY,
    {
      alias: node.alias,
      blockRef: node.blockRef,
      heading: node.heading,
      itemId: ports.withIds ? node.itemId : null,
      title: target,
    },
    voidMarks(node),
  );
};

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
  };
  if (node.title !== undefined) {
    image.title = node.title;
  }
  return image;
};

// a file the library holds is written as `![](path)`, which reads back as that file's block
const writeFileBlock = (node: Element<"file"> | Element<"video">, ports: WritePorts): TElement => {
  if (node.url !== undefined) {
    return { children: voidLeaf(node), type: node.type, url: node.url };
  }
  const name = node.type === "file" ? (node.name ?? null) : null;
  const url = ports.path({ name, node: node.type, sha: node.sha ?? "" });
  return { caption: [leaf("", {})], children: voidLeaf(node), type: "img", url };
};

const writeNode = (node: LibraryNode, ports: WritePorts): Descendant => {
  if ("text" in node) {
    return { ...node };
  }
  switch (node.type) {
    case "wikiLink":
    case "wikiEmbed": {
      return spellWiki(node, ports);
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

// a block's `ref` at the end of its own last line, or on a line of its own after it
const withRef = (block: TElement, ref: string): TElement[] => {
  if (!INLINE_REF_TYPES.has(block.type)) {
    return [block, { children: [leaf(`^${ref}`, {})], type: "p" }];
  }
  return [{ ...block, children: tidyInlines([...block.children, leaf(` ^${ref}`, {})]) }];
};

// blocks as the editor's value, ready for the rule table
export const writeBlocks = (blocks: readonly LibraryBlock[], ports: WritePorts): TElement[] =>
  blocks.flatMap((block) => {
    const { ref, ...rest } = block;
    const written = writeNode(rest, ports);
    if (isText(written)) {
      return [];
    }
    return ref === undefined ? [written] : withRef(written, ref);
  });
