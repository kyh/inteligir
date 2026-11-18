import type { Descendant, TElement, TText } from "platejs";

import type { LibraryBlock, LibraryNode } from "@repo/contract/library/library-nodes";

import { INLINE_TYPES } from "./read-blocks";
import { isText, leaf, marksOf, tidyInlines } from "./slate-leaves";
import type { Marks } from "./slate-leaves";

export interface WrittenFile {
  readonly sha: string;
  readonly node: "img" | "file" | "video";
  readonly name: string | null;
}

export interface WritePorts {
  readonly target: (itemId: string) => string | null;
  readonly path: (file: WrittenFile) => string;
}

const voidMarks = (node: { children: readonly TText[] }) =>
  (node.children[0] === undefined ? {} : marksOf(node.children[0])) satisfies Marks;

const voidLeaf = (node: { children: readonly TText[] }) =>
  [leaf("", voidMarks(node))] satisfies TText[];

const indentOf = (node: { indent?: number | undefined }) =>
  (node.indent === undefined ? {} : { indent: node.indent }) satisfies { indent?: number };

type Element<T extends string> = Extract<LibraryNode, { type: T }>;

const spellMention = (node: Element<"mention">, ports: WritePorts) =>
  ({
    children: voidLeaf(node),
    key: node.key,
    type: "mention",
    value: ports.target(node.key) ?? node.value,
  }) satisfies TElement;

const writeImage = (node: Element<"img">, ports: WritePorts) => {
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

const writeFileBlock = (node: Element<"file"> | Element<"video">, ports: WritePorts) => {
  if (node.url !== undefined) {
    return {
      children: voidLeaf(node),
      type: node.type,
      url: node.url,
      ...indentOf(node),
    } satisfies TElement;
  }

  const name = node.type === "file" ? (node.name ?? null) : null;
  const url = ports.path({ name, node: node.type, sha: node.sha ?? "" });

  return {
    caption: [leaf("", {})],
    children: voidLeaf(node),
    type: "img",
    url,
    ...indentOf(node),
  } satisfies TElement;
};

const writeNode: (node: LibraryNode, ports: WritePorts) => Descendant = (
  node: LibraryNode,
  ports: WritePorts,
) => {
  if ("text" in node) {
    return { ...node } satisfies Descendant;
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

      return { ...node, children: inline ? tidyInlines(children) : children } satisfies Descendant;
    }
  }
};

export const writeBlocks = (blocks: readonly LibraryBlock[], ports: WritePorts) =>
  blocks.flatMap((block) => {
    const written = writeNode(block, ports);

    return isText(written) ? [] : [written];
  });
