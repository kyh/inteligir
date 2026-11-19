import { ElementApi } from "platejs";
import type { Descendant, TElement, TText } from "platejs";

import type { FileKind } from "@repo/contract/items/item-kind";
import type { JsonValue } from "@repo/contract/library/canonical-json";
import { libraryNodeSchema } from "@repo/contract/library/library-nodes";

import { z } from "zod";

import { stringProp } from "@repo/editor/headless/node-props";

import { MARK_KEYS, isText, leaf, marksOf, tidyInlines } from "./slate-leaves";

export interface LibraryFile {
  readonly sha: string;
  readonly kind: FileKind;
  readonly name: string;
  readonly path: string;
}

export interface LinkedItem {
  readonly itemId: string;
  readonly title: string;
}

export interface ReadPorts {
  readonly item: (key: string, shown: string) => LinkedItem | null;
  readonly image: (url: string) => LibraryFile | null;
}

export interface DraftBlock {
  readonly element: TElement;
}

const [, elementUnion] = libraryNodeSchema.options;

const ELEMENT_PROPS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  elementUnion.options.map((schema) => [
    schema.shape.type.value,
    new Set(Object.keys(schema.shape)),
  ]),
);

export const INLINE_TYPES: ReadonlySet<string> = new Set([
  "a",
  "date",
  "formulaPill",
  "inline_equation",
  "mention",
]);

const isElement = (node: Descendant): node is TElement => ElementApi.isElement(node);

const voidLeaf = () => [leaf("", {})] satisfies TText[];

const WIDTH_RE = /\|(?<width>\d{1,5})(?:x\d{1,5})?$/u;

const widthIn = (text: string) => {
  const width = Number(WIDTH_RE.exec(text)?.groups?.width ?? Number.NaN);

  return Number.isInteger(width) && width > 0 ? width : null;
};

interface ImageLook {
  readonly caption: readonly TText[];
  readonly title: string | null;
  readonly width: number | null;
}

const imageOf = (source: { sha: string } | { url: string }, look: ImageLook) => {
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

const mediaOf = (file: LibraryFile, look: ImageLook) => {
  switch (file.kind) {
    case "image": {
      return imageOf({ sha: file.sha }, look);
    }

    case "video": {
      return { children: voidLeaf(), sha: file.sha, type: "video" } satisfies TElement;
    }

    case "pdf":
    case "audio":
    case "file": {
      return {
        children: voidLeaf(),
        name: file.name,
        sha: file.sha,
        type: "file",
      } satisfies TElement;
    }

    default: {
      throw new Error(`unexpected ${String(file.kind satisfies never)}`);
    }
  }
};

const readMention = (node: TElement, ports: ReadPorts) => {
  const shown = stringProp(node, "value") ?? "";
  const linked = ports.item(stringProp(node, "key") ?? "", shown);

  return (
    linked === null
      ? leaf(shown, {})
      : { children: voidLeaf(), key: linked.itemId, type: "mention", value: linked.title }
  ) satisfies Descendant;
};

const captionOf: (node: TElement) => TText[] = (node: TElement) => {
  const { caption } = node;

  return (
    Array.isArray(caption) ? caption.filter((part: Descendant): part is TText => isText(part)) : []
  ) satisfies TText[];
};

const readImage = (node: TElement, ports: ReadPorts) => {
  const url = stringProp(node, "url") ?? "";
  const caption = captionOf(node);

  if (url === "") {
    const alt = caption.map((part) => part.text).join("");

    return { children: [leaf(`![${alt}]()`, {})], type: "p" } satisfies TElement;
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

const readVoid = (node: TElement, ports: ReadPorts) => {
  switch (node.type) {
    case "mention": {
      return readMention(node, ports);
    }

    case "img": {
      return readImage(node, ports);
    }

    default: {
      return null;
    }
  }
};

const readNode: (node: Descendant, ports: ReadPorts) => Descendant[] = (
  node: Descendant,
  ports: ReadPorts,
) => {
  if (isText(node)) {
    return [leaf(node.text, marksOf(node))] satisfies Descendant[];
  }

  if (node.type === "a" && (stringProp(node, "url") ?? "") === "") {
    return node.children.flatMap((child) => readNode(child, ports));
  }

  const mapped = readVoid(node, ports);

  if (mapped !== null) {
    return [mapped] satisfies Descendant[];
  }

  return [
    { ...node, children: node.children.flatMap((child) => readNode(child, ports)) },
  ] satisfies Descendant[];
};

export const tidyBlock: (node: TElement) => TElement = (node: TElement) => {
  const children = node.children.map((child) => (isElement(child) ? tidyBlock(child) : child));

  const inline = children.every((child) => !isElement(child) || INLINE_TYPES.has(child.type));
  const tidied = inline ? tidyInlines(children) : children;

  return { ...node, children: tidied.length > 0 ? tidied : [leaf("", {})] } satisfies TElement;
};

export const readBlocks = (value: readonly Descendant[], ports: ReadPorts) =>
  value.flatMap((node) =>
    readNode(node, ports).flatMap(
      (read) => (isElement(read) ? [{ element: tidyBlock(read) }] : []) satisfies DraftBlock[],
    ),
  );

interface JsonObject {
  [key: string]: JsonValue;
}

const propValue = z.json();

const textJson = (node: TText) => {
  const json: JsonObject = { text: node.text };

  for (const key of MARK_KEYS) {
    if (node[key] === true) {
      json[key] = true;
    }
  }

  return json;
};

const elementJson = (node: TElement) => {
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

export const libraryJsonOf = (node: Descendant) =>
  isText(node) ? textJson(node) : elementJson(node);

export const namedBlockJson = (draft: DraftBlock, id: string) =>
  ({
    ...elementJson(draft.element),
    id,
  }) satisfies JsonObject;
