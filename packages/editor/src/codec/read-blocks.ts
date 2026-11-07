// The dialect's value, already the library's vocabulary as the rule table writes it
// (`md-rules.ts`), with its names resolved: a wiki link or an embed by the title or path the writer
// gave to the item that answers to it, a file the library holds by its bytes to its sha. A `ref`
// the note's reader found (`@repo/notes/markdown/remark-obsidian`) moves off its line onto the
// block. A `#tag` is the text it is. Every block leaves through the vocabulary's own parse, so a
// prop it does not name is dropped here and never stored.

import { ElementApi } from "platejs";
import type { Descendant, TElement, TText } from "platejs";

import type { FileKind } from "@repo/notes/items/item-kind";
import type { JsonValue } from "@repo/notes/library/canonical-json";
import { libraryNodeSchema } from "@repo/notes/library/library-nodes";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";

import { z } from "zod";

import { WIKI_EMBED_KEY, WIKI_LINK_KEY } from "@repo/editor/dialect-node-keys";
import { BLOCK_REF_KEY } from "@repo/editor/markdown/md-rules";
import { stringProp } from "@repo/editor/node-props";
import {
  isSameItemLink,
  wikiBodyOf,
  wikiFieldsOf,
  wikiNode,
  wikiPartsOf,
} from "@repo/editor/wiki/wiki-node";

import { MARK_KEYS, isText, leaf, marksOf, tidyInlines } from "./slate-leaves";

// a file the library holds by its bytes
export interface LibraryFile {
  readonly sha: string;
  readonly kind: FileKind;
  // the name it was written under, which a file block shows
  readonly name: string;
  // where the reader found it: the address an image that embeds it is written with
  readonly path: string;
}

// what a `[[…]]` or `![[…]]` reaches: an item (its title, which a link keeps as the name the writer
// saw), a file's bytes, no item but under a title the caller names as it was written, or nothing
// the library holds yet, whose title is the written target's own name
export type Reached =
  | { readonly kind: "item"; readonly itemId: string; readonly title: string }
  | { readonly kind: "file"; readonly file: LibraryFile }
  | { readonly kind: "title"; readonly title: string }
  | null;

export interface ReadPorts {
  readonly wiki: (link: WikiBody, embed: boolean) => Reached;
  // the bytes a markdown image's address names; null keeps the address
  readonly image: (url: string) => LibraryFile | null;
}

// a top-level block in the vocabulary's shape, not yet named: the caller mints its id
export interface DraftBlock {
  readonly element: TElement;
  readonly ref: string | null;
}

// the vocabulary's own props per element type, read off its schemas so a prop it gains or loses
// needs no second edit here
const [, elementUnion] = libraryNodeSchema.options;
const ELEMENT_PROPS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  elementUnion.options.map((schema) => [
    schema.shape.type.value,
    new Set(Object.keys(schema.shape)),
  ]),
);

// the nodes that sit inside a line: text, the inline voids and a link
export const INLINE_TYPES: ReadonlySet<string> = new Set([
  "a",
  "annotationMarker",
  "date",
  "formulaPill",
  "inline_equation",
  "opaque",
  "wikiEmbed",
  "wikiLink",
]);

const isElement = (node: Descendant): node is TElement => ElementApi.isElement(node);

const voidLeaf = (): TText[] => [leaf("", {})];

const opaqueOf = (source: string): TElement => ({
  children: voidLeaf(),
  source,
  type: "opaque",
});

// a written target's own name: its last segment, less the extension a link may leave off
const writtenTitle = (target: string): string => {
  const name = target.slice(target.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -".md".length) : name;
};

// an image's Obsidian width, `300` (or `300x200`), after its alt's last pipe
const WIDTH_RE = /\|(?<width>\d{1,5})(?:x\d{1,5})?$/u;

const widthIn = (text: string): number | null => {
  const width = Number(WIDTH_RE.exec(text)?.groups?.width ?? Number.NaN);
  return Number.isInteger(width) && width > 0 ? width : null;
};

interface ImageLook {
  readonly caption: readonly TText[];
  readonly title: string | null;
  readonly width: number | null;
}

// an image by its bytes or its address, with what the alt and the title said of it
const imageOf = (source: { sha: string } | { url: string }, look: ImageLook): TElement => {
  const image: TElement = { ...source, children: voidLeaf(), type: "img" };
  if (look.caption.length > 0) {
    image.caption = look.caption;
  }
  if (look.title !== null) {
    image.title = look.title;
  }
  if (look.width !== null) {
    image.width = look.width;
  }
  return image;
};

const mediaOf = (file: LibraryFile, look: ImageLook): TElement => {
  switch (file.kind) {
    case "image": {
      return imageOf({ sha: file.sha }, look);
    }
    case "video": {
      return { children: voidLeaf(), sha: file.sha, type: "video" };
    }
    case "pdf":
    case "audio":
    case "file": {
      return { children: voidLeaf(), name: file.name, sha: file.sha, type: "file" };
    }
    // no default
  }
};

// an anchor alone stays in the item it stands in; a link that reaches an item names it by id and
// shows its title, which it may not have yet; one that reaches none waits, by the name the writer
// gave, for an item of that name. A link that reaches nothing and has no name is kept as source
const readWiki = (node: TElement, embed: boolean, ports: ReadPorts): TElement => {
  const written = wikiFieldsOf(node);
  if (isSameItemLink(written)) {
    return node;
  }
  const reached = ports.wiki(wikiPartsOf(written), embed);
  const item = reached?.kind === "item" ? reached : null;
  const named = reached?.kind === "title" ? reached.title : writtenTitle(written.title);
  const title = item?.title ?? named;
  if (item === null && title.trim() === "") {
    return opaqueOf(`${embed ? "!" : ""}[[${wikiBodyOf(written) ?? ""}]]`);
  }
  return wikiNode(embed ? WIKI_EMBED_KEY : WIKI_LINK_KEY, {
    ...written,
    itemId: item?.itemId ?? null,
    title,
  });
};

const captionOf = (node: TElement): TText[] => {
  const { caption } = node;
  return Array.isArray(caption)
    ? caption.filter((part: Descendant): part is TText => isText(part))
    : [];
};

// an image's alt as its caption, an Obsidian `|width` at its end read off it; one with no address
// is no image the vocabulary holds, so it stays the source it was written as
const readImage = (node: TElement, ports: ReadPorts): TElement => {
  const url = stringProp(node, "url") ?? "";
  const caption = captionOf(node);
  if (url === "") {
    const alt = caption.map((part) => part.text).join("");
    return { children: [opaqueOf(`![${alt}]()`)], type: "p" };
  }
  const lastIndex = caption.length - 1;
  const last = caption[lastIndex];
  const width = last === undefined ? null : widthIn(last.text);
  const texts =
    width === null || last === undefined
      ? caption
      : caption.with(lastIndex, { ...last, text: last.text.replace(WIDTH_RE, "") });
  const shown = tidyInlines(texts).filter(
    (part): part is TText => isText(part) && part.text !== "",
  );
  const look: ImageLook = {
    caption: shown.map((part) => leaf(part.text, marksOf(part))),
    title: stringProp(node, "title") ?? null,
    width,
  };
  const file = ports.image(url);
  return file === null ? imageOf({ url }, look) : mediaOf(file, look);
};

// a node whose written name resolves: a link or embed to its item, an image to the bytes it names
const readVoid = (node: TElement, ports: ReadPorts): TElement | null => {
  switch (node.type) {
    case WIKI_LINK_KEY: {
      return readWiki(node, false, ports);
    }
    case WIKI_EMBED_KEY: {
      return readWiki(node, true, ports);
    }
    case "img": {
      return readImage(node, ports);
    }
    default: {
      return null;
    }
  }
};

const readNode = (node: Descendant, ports: ReadPorts): Descendant[] => {
  if (isText(node)) {
    return [leaf(node.text, marksOf(node))];
  }
  // a link with no address reaches nothing, and the vocabulary holds none, so it is its words
  if (node.type === "a" && (stringProp(node, "url") ?? "") === "") {
    return node.children.flatMap((child) => readNode(child, ports));
  }
  const mapped = readVoid(node, ports);
  if (mapped !== null) {
    return [mapped];
  }
  return [{ ...node, children: node.children.flatMap((child) => readNode(child, ports)) }];
};

// an element's children tidied the way Slate keeps a line, less the empty texts Slate keeps around
// an inline void: the one spelling a block is stored in, whichever editor or reader made it
export const tidyBlock = (node: TElement): TElement => {
  const children = node.children.map((child): Descendant =>
    isElement(child) ? tidyBlock(child) : child,
  );
  const inline = children.every((child) => !isElement(child) || INLINE_TYPES.has(child.type));
  const tidied = inline ? tidyInlines(children) : children;
  return { ...node, children: tidied.length > 0 ? tidied : [leaf("", {})] };
};

// the types a block's trailing `^ref` is read from and written to, inside its own last line
export const INLINE_REF_TYPES: ReadonlySet<string> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

// a read block among the drafts: a `ref` at its end comes off it, and one on a line of its own names
// the block above, or stays the words it is where that block has one
const draftInto = (drafts: DraftBlock[], block: TElement): void => {
  const last = block.children.at(-1);
  const ref =
    last !== undefined && isElement(last) && last.type === BLOCK_REF_KEY
      ? stringProp(last, "ref")
      : undefined;
  if (ref === undefined) {
    drafts.push({ element: tidyBlock(block), ref: null });
    return;
  }
  if (last?.own !== true) {
    const element = tidyBlock({ ...block, children: block.children.slice(0, -1) });
    drafts.push({ element, ref });
    return;
  }
  const above = drafts.at(-1);
  if (above?.ref === null) {
    drafts[drafts.length - 1] = { ...above, ref };
    return;
  }
  drafts.push({ element: tidyBlock({ ...block, children: [leaf(`^${ref}`, {})] }), ref: null });
};

// the top-level blocks of one section, in the vocabulary's shapes
export const readBlocks = (value: readonly Descendant[], ports: ReadPorts): DraftBlock[] => {
  const drafts: DraftBlock[] = [];
  for (const node of value) {
    for (const read of readNode(node, ports)) {
      if (isElement(read)) {
        draftInto(drafts, read);
      }
    }
  }
  return drafts;
};

interface JsonObject {
  [key: string]: JsonValue;
}

// a Slate prop is whatever a plugin left there; the vocabulary keeps only JSON
const propValue = z.json();

const textJson = (node: TText): JsonObject => {
  const json: JsonObject = { text: node.text };
  for (const key of MARK_KEYS) {
    if (node[key] === true) {
      json[key] = true;
    }
  }
  return json;
};

// the JSON the vocabulary reads: an element's own props and its children, a text's marks
const elementJson = (node: TElement): JsonObject => {
  const allowed = ELEMENT_PROPS.get(node.type) ?? new Set<string>();
  const json: JsonObject = {};
  for (const key of allowed) {
    if (key === "children" || key === "caption" || key === "type") {
      continue;
    }
    const value = propValue.safeParse(node[key]);
    if (value.success) {
      json[key] = value.data;
    }
  }
  const { caption } = node;
  if (allowed.has("caption") && Array.isArray(caption)) {
    json.caption = caption.flatMap((part: Descendant) => (isText(part) ? [textJson(part)] : []));
  }
  json.children = node.children.map((child) =>
    isText(child) ? textJson(child) : elementJson(child),
  );
  json.type = node.type;
  return json;
};

// a node as the vocabulary's JSON
export const libraryJsonOf = (node: Descendant): JsonObject =>
  isText(node) ? textJson(node) : elementJson(node);

// a draft named: the JSON a top-level block is stored as, before the vocabulary's parse
export const namedBlockJson = (draft: DraftBlock, id: string): JsonObject => {
  const json = { ...elementJson(draft.element), id };
  return draft.ref === null ? json : { ...json, ref: draft.ref };
};
