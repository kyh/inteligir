// The dialect's value as the persisted vocabulary: what the rule table parsed (the editor's own
// shapes, `md-rules.ts`) mapped node by node onto `@repo/notes/library/library-nodes`. A wiki link
// or an embed is resolved to the item it names, a file the library holds by its bytes is named by
// its sha, and the person's own writing reads Obsidian's spellings too: `#tag`, `==highlight==`,
// `%%comment%%` and a block's `^ref`. The page a fill read is kept as the page wrote it, so none of
// those reads in an article. Every block leaves through the vocabulary's own parse, so a prop it
// does not name is dropped here and never stored.

import { ElementApi } from "platejs";
import type { Descendant, TElement, TText } from "platejs";

import { clipQuote } from "@repo/notes/annotations/store-schema";
import type { FileKind } from "@repo/notes/items/item-kind";
import { inlineTagSpans } from "@repo/notes/knowledge/tag-grammar";
import type { JsonValue } from "@repo/notes/library/canonical-json";
import { blockIdSchema, libraryNodeSchema } from "@repo/notes/library/library-nodes";
import { isUuidWikiAlias, parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";

import { z } from "zod";

import { stringProp } from "@repo/editor/node-props";

import { MARK_KEYS, isText, leaf, marksOf, tidyInlines } from "./slate-leaves";
import type { Marks } from "./slate-leaves";

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
// saw), a file's bytes, or nothing the library holds yet
export type Reached =
  | { readonly kind: "item"; readonly itemId: string; readonly title: string }
  | { readonly kind: "file"; readonly file: LibraryFile }
  | null;

export interface ReadPorts {
  readonly wiki: (link: WikiBody, embed: boolean) => Reached;
  // the bytes a markdown image's address names; null keeps the address
  readonly image: (url: string) => LibraryFile | null;
}

// what reading the person's own writing needs beside: an id for each highlight an `==x==` makes
export interface PersonPorts {
  readonly newAnnotationId: () => string;
}

// a bare highlight an `==x==` made: its markers now wrap the passage
export interface ReadHighlight {
  readonly id: string;
  readonly quote: string;
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
const INLINE_TYPES = new Set([
  "a",
  "annotationMarker",
  "date",
  "formulaPill",
  "inline_equation",
  "opaque",
  "tag",
  "wikiEmbed",
  "wikiLink",
]);

// where a node sits: no text rule reads inside code or a link's label
interface Scope {
  readonly literal: boolean;
}

interface Reading {
  readonly ports: ReadPorts;
  // null for a page, which keeps its text as it wrote it
  readonly person: PersonPorts | null;
  readonly highlights: ReadHighlight[];
}

const isElement = (node: Descendant): node is TElement => ElementApi.isElement(node);

const voidLeaf = (marks: Marks): TText[] => [leaf("", marks)];

const tagOf = (value: string, marks: Marks): TElement => ({
  children: voidLeaf(marks),
  type: "tag",
  value,
});

const markerOf = (id: string, edge: "start" | "end", marks: Marks): TElement => ({
  children: voidLeaf(marks),
  edge,
  ids: id,
  type: "annotationMarker",
});

const opaqueOf = (source: string, marks: Marks = {}): TElement => ({
  children: voidLeaf(marks),
  source,
  type: "opaque",
});

// Obsidian's comment, `%%x%%`, kept as its source; an annotation marker's `%%i:` the dialect
// already read, so what is left of one here is text
const COMMENT_RE = /%%(?!i:)[^%\n][^%]*%%/gu;
// Obsidian's highlight, `==x==`: no edge whitespace and no `=` inside, as its own reader asks
const HIGHLIGHT_RE = /[=]=(?<passage>[^=\s](?:[^=]*[^=\s])?)==/gu;

// a text cut at every match of `pattern`, each match read by `piece` and the rest by `rest`
const splitBy = (
  text: string,
  pattern: RegExp,
  piece: (match: RegExpMatchArray) => Descendant[],
  rest: (between: string) => Descendant[],
): Descendant[] => {
  const out: Descendant[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    out.push(...rest(text.slice(cursor, match.index)), ...piece(match));
    cursor = match.index + match[0].length;
  }
  out.push(...rest(text.slice(cursor)));
  return out;
};

const tagsIn = (text: string, marks: Marks): Descendant[] => {
  const out: Descendant[] = [];
  let cursor = 0;
  for (const span of inlineTagSpans(text)) {
    out.push(leaf(text.slice(cursor, span.start), marks), tagOf(span.tag, marks));
    cursor = span.end;
  }
  out.push(leaf(text.slice(cursor), marks));
  return out;
};

const highlightsIn = (
  text: string,
  marks: Marks,
  person: PersonPorts,
  highlights: ReadHighlight[],
): Descendant[] =>
  splitBy(
    text,
    HIGHLIGHT_RE,
    (match) => {
      const passage = match.groups?.["passage"] ?? "";
      const id = person.newAnnotationId();
      highlights.push({ id, quote: clipQuote(passage) });
      return [markerOf(id, "start", marks), ...tagsIn(passage, marks), markerOf(id, "end", marks)];
    },
    (between) => tagsIn(between, marks),
  );

const personText = (
  text: string,
  marks: Marks,
  person: PersonPorts,
  highlights: ReadHighlight[],
): Descendant[] =>
  splitBy(
    text,
    COMMENT_RE,
    (match) => [opaqueOf(match[0], marks)],
    (between) => highlightsIn(between, marks, person, highlights),
  );

const readText = (node: TText, scope: Scope, reading: Reading): Descendant[] => {
  const marks = marksOf(node);
  if (reading.person === null || scope.literal || marks.code === true) {
    return [leaf(node.text, marks)];
  }
  return personText(node.text, marks, reading.person, reading.highlights);
};

// `^abc` names a block a link reaches by `[[Note#^abc]]`
const BLOCK_REF_RE = /^\^(?<ref>[A-Za-z0-9-]+)$/u;
const TRAILING_REF_RE = /[ \t]\^(?<ref>[A-Za-z0-9-]+)$/u;

const isBlockRef = (ref: string | undefined): ref is string =>
  ref !== undefined && blockIdSchema.safeParse(ref).success;

// a link's anchor: a block's `^ref`, or a heading
const withAnchor = (element: TElement, anchor: string | undefined): TElement => {
  if (anchor === undefined) {
    return element;
  }
  const ref = BLOCK_REF_RE.exec(anchor)?.groups?.["ref"];
  return isBlockRef(ref) ? { ...element, blockRef: ref } : { ...element, heading: anchor };
};

// a written target's own name: its last segment, less the extension a link may leave off
const writtenTitle = (target: string): string => {
  const name = target.slice(target.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -".md".length) : name;
};

// an image's Obsidian width, `300` (or `300x200`), after its alt's last pipe
const WIDTH_RE = /\|(?<width>\d{1,5})(?:x\d{1,5})?$/u;

const widthIn = (text: string): number | null => {
  const width = Number(WIDTH_RE.exec(text)?.groups?.["width"] ?? Number.NaN);
  return Number.isInteger(width) && width > 0 ? width : null;
};

interface ImageLook {
  readonly caption: readonly TText[];
  readonly title: string | null;
  readonly width: number | null;
}

// an image by its bytes or its address, with what the alt and the title said of it
const imageOf = (source: { sha: string } | { url: string }, look: ImageLook): TElement => {
  const image: TElement = { ...source, children: voidLeaf({}), type: "img" };
  if (look.caption.length > 0) {
    image["caption"] = look.caption;
  }
  if (look.title !== null) {
    image["title"] = look.title;
  }
  if (look.width !== null) {
    image["width"] = look.width;
  }
  return image;
};

const mediaOf = (file: LibraryFile, look: ImageLook): TElement => {
  switch (file.kind) {
    case "image": {
      return imageOf({ sha: file.sha }, look);
    }
    case "video": {
      return { children: voidLeaf({}), sha: file.sha, type: "video" };
    }
    case "pdf":
    case "audio":
    case "file": {
      return { children: voidLeaf({}), name: file.name, sha: file.sha, type: "file" };
    }
    // no default
  }
};

const readWikiLink = (node: TElement, reading: Reading): TElement => {
  const body = stringProp(node, "body") ?? "";
  const link = parseWikiBody(body);
  const reached = reading.ports.wiki(link, false);
  const item = reached?.kind === "item" ? reached : null;
  const title = item?.title ?? writtenTitle(link.target);
  if (title.trim() === "") {
    return opaqueOf(`[[${body}]]`);
  }
  const element: TElement = {
    children: voidLeaf({}),
    itemId: item?.itemId ?? null,
    title,
    type: "wikiLink",
  };
  if (link.alias !== undefined && !isUuidWikiAlias(link.alias)) {
    element["alias"] = link.alias;
  }
  return withAnchor(element, link.anchor);
};

// an embed of an item; one of a file was made an image before the value was settled
// (`embed-files.ts`), so what is left is an embed the library holds nothing for, kept as source
const readWikiEmbed = (node: TElement, reading: Reading): TElement => {
  const body = stringProp(node, "body") ?? "";
  const link = parseWikiBody(body);
  const reached = reading.ports.wiki(link, true);
  if (reached?.kind !== "item") {
    return opaqueOf(`![[${body}]]`);
  }
  return withAnchor(
    { children: voidLeaf({}), itemId: reached.itemId, type: "wikiEmbed" },
    link.anchor,
  );
};

const captionOf = (node: TElement): TText[] => {
  const { caption } = node;
  return Array.isArray(caption) ? caption.filter((part): part is TText => isText(part)) : [];
};

// an image's alt as its caption, an Obsidian `|width` at its end read off it
const readImage = (node: TElement, reading: Reading): TElement => {
  const url = stringProp(node, "url") ?? "";
  const caption = captionOf(node);
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
  const file = reading.ports.image(url);
  return file === null ? imageOf({ url }, look) : mediaOf(file, look);
};

const readFormula = (node: TElement): TElement => {
  const pill: TElement = {
    children: voidLeaf({}),
    display: stringProp(node, "display") ?? "",
    source: stringProp(node, "source") ?? "",
    type: "formulaPill",
  };
  const meta = stringProp(node, "meta");
  if (meta !== undefined && meta !== "") {
    pill["meta"] = meta;
  }
  return pill;
};

// the editor's spelling of a dialect void as the vocabulary's, or null where they agree
const readVoid = (node: TElement, reading: Reading): TElement | null => {
  switch (node.type) {
    case "wikiLink": {
      return readWikiLink(node, reading);
    }
    case "wikiEmbed": {
      return readWikiEmbed(node, reading);
    }
    case "img": {
      return readImage(node, reading);
    }
    case "opaqueInline": {
      return opaqueOf(stringProp(node, "value") ?? "");
    }
    case "formulaPill": {
      return readFormula(node);
    }
    default: {
      return null;
    }
  }
};

const LITERAL_TYPES = new Set(["a", "code_block", "code_line"]);

const readNode = (node: Descendant, scope: Scope, reading: Reading): Descendant[] => {
  if (isText(node)) {
    return readText(node, scope, reading);
  }
  const mapped = readVoid(node, reading);
  if (mapped !== null) {
    return [mapped];
  }
  const inner: Scope = { ...scope, literal: scope.literal || LITERAL_TYPES.has(node.type) };
  return [{ ...node, children: node.children.flatMap((child) => readNode(child, inner, reading)) }];
};

// an element's children tidied the way Slate keeps a line
const tidyTree = (node: TElement): TElement => {
  const children = node.children.map((child): Descendant =>
    isElement(child) ? tidyTree(child) : child,
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

// a line block's trailing ` ^ref`, taken off its last text
const trailingRef = (block: TElement): DraftBlock => {
  const index = block.children.length - 1;
  const last = block.children[index];
  if (!INLINE_REF_TYPES.has(block.type) || last === undefined || !isText(last)) {
    return { element: block, ref: null };
  }
  const match = TRAILING_REF_RE.exec(last.text);
  const ref = match?.groups?.["ref"];
  if (match === null || !isBlockRef(ref)) {
    return { element: block, ref: null };
  }
  const text = last.text.slice(0, match.index);
  const children =
    text === ""
      ? block.children.toSpliced(index, 1)
      : block.children.with(index, { ...last, text });
  return { element: { ...block, children: children.length > 0 ? children : [leaf("", {})] }, ref };
};

// a paragraph that is only `^ref`: Obsidian's name for the block above it
const standaloneRef = (block: TElement): string | null => {
  const [only, ...rest] = block.children;
  if (block.type !== "p" || block["listStyleType"] !== undefined || rest.length > 0) {
    return null;
  }
  const ref =
    only !== undefined && isText(only) ? BLOCK_REF_RE.exec(only.text)?.groups?.["ref"] : undefined;
  return isBlockRef(ref) ? ref : null;
};

export interface ReadDrafts {
  readonly blocks: readonly DraftBlock[];
  readonly highlights: readonly ReadHighlight[];
}

// the top-level blocks of one section, in the vocabulary's shapes; `person` is given for the
// person's own writing, which alone reads Obsidian's spellings
export const readBlocks = (
  value: readonly Descendant[],
  ports: ReadPorts,
  person: PersonPorts | null,
): ReadDrafts => {
  const reading: Reading = { highlights: [], person, ports };
  const blocks: DraftBlock[] = [];
  const scope: Scope = { literal: false };
  for (const node of value) {
    for (const read of readNode(node, scope, reading)) {
      if (!isElement(read)) {
        continue;
      }
      const element = tidyTree(read);
      const last = blocks.at(-1);
      const ref = person === null ? null : standaloneRef(element);
      if (ref !== null && last !== undefined && last.ref === null) {
        blocks[blocks.length - 1] = { ...last, ref };
        continue;
      }
      blocks.push(person === null ? { element, ref: null } : trailingRef(element));
    }
  }
  return { blocks, highlights: reading.highlights };
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
    json["caption"] = caption.flatMap((part: Descendant) => (isText(part) ? [textJson(part)] : []));
  }
  json["children"] = node.children.map((child) =>
    isText(child) ? textJson(child) : elementJson(child),
  );
  json["type"] = node.type;
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
