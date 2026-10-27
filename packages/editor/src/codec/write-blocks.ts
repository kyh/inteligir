// The persisted vocabulary back in the dialect: blocks mapped onto the editor's own shapes, which
// the rule table writes (`md-rules.ts`), so an item leaves as the bytes a rich save would write. A
// link names its target as the caller spells it (a file's shortest name in an export, the item's
// live title and id in the agent's view), a file the library holds by its bytes is written at the
// path the caller gives it, a tag is its `#name` again, and a block's `ref` its Obsidian `^ref`.

import type { Descendant, TElement, TText } from "platejs";

import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";
import { serializeWikiBody } from "@repo/notes/markdown/remark-wiki-link";

import { INLINE_REF_TYPES } from "./read-blocks";
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

// a target a wiki link cannot carry loses the characters that end the construct
const UNCARRIABLE_RE = /[[\]|\r\n]+/gu;

interface WikiParts {
  readonly target: string;
  readonly anchor: string | undefined;
  readonly alias: string | undefined;
}

// the body a link writes: as asked, else with the target stripped of what no link can carry
const wikiBody = (parts: WikiParts): string | null =>
  serializeWikiBody(parts) ??
  serializeWikiBody({ ...parts, target: parts.target.replaceAll(UNCARRIABLE_RE, " ").trim() });

const anchorOf = (node: { heading?: string; blockRef?: string }): string | undefined =>
  node.heading ?? (node.blockRef === undefined ? undefined : `^${node.blockRef}`);

type Element<T extends string> = Extract<LibraryNode, { type: T }>;

const writeWikiLink = (node: Element<"wikiLink">, ports: WritePorts): Descendant => {
  const target = (node.itemId === null ? null : ports.target(node.itemId)) ?? node.title;
  const idAlias = ports.withIds && node.itemId !== null ? node.itemId : undefined;
  const body = wikiBody({ alias: node.alias ?? idAlias, anchor: anchorOf(node), target });
  return body === null
    ? leaf(node.alias ?? node.title, {})
    : { body, children: voidLeaf(node), type: "wikiLink" };
};

const writeWikiEmbed = (node: Element<"wikiEmbed">, ports: WritePorts): Descendant => {
  const target = ports.target(node.itemId) ?? node.itemId;
  const body = wikiBody({
    alias: ports.withIds ? node.itemId : undefined,
    anchor: anchorOf(node),
    target,
  });
  return body === null ? leaf(target, {}) : { body, children: voidLeaf(node), type: "wikiEmbed" };
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
    image["title"] = node.title;
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

const formulaRaw = (node: Element<"formulaPill">): string => {
  if (node.meta !== undefined) {
    return `${node.source}|${node.display}|${node.meta}`;
  }
  return node.display === "" ? node.source : `${node.source}|${node.display}`;
};

// the editor's inline types, as written
const INLINE_WRITTEN = new Set([
  "a",
  "annotationMarker",
  "date",
  "formulaPill",
  "inline_equation",
  "opaqueInline",
  "wikiEmbed",
  "wikiLink",
]);

const writeNode = (node: LibraryNode, ports: WritePorts): Descendant[] => {
  if ("text" in node) {
    return [{ ...node }];
  }
  switch (node.type) {
    case "tag": {
      return [leaf(`#${node.value}`, voidMarks(node))];
    }
    case "wikiLink": {
      return [writeWikiLink(node, ports)];
    }
    case "wikiEmbed": {
      return [writeWikiEmbed(node, ports)];
    }
    case "img": {
      return [writeImage(node, ports)];
    }
    case "file":
    case "video": {
      return [writeFileBlock(node, ports)];
    }
    case "opaque": {
      return [{ children: voidLeaf(node), type: "opaqueInline", value: node.source }];
    }
    case "formulaPill": {
      const pill: TElement = {
        children: voidLeaf(node),
        display: node.display,
        meta: node.meta ?? "",
        raw: formulaRaw(node),
        source: node.source,
        type: "formulaPill",
      };
      return [pill];
    }
    default: {
      const children = node.children.flatMap((child) => writeNode(child, ports));
      const inline = children.every((child) => isText(child) || INLINE_WRITTEN.has(child.type));
      return [{ ...node, children: inline ? tidyInlines(children) : children }];
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
    const written = writeNode(rest, ports).flatMap((node) => (isText(node) ? [] : [node]));
    return ref === undefined ? written : written.flatMap((element) => withRef(element, ref));
  });
