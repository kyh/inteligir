import { z } from "zod";

import { itemNameFromUrl } from "../items/item-name";
import { urlKey, urlSearchText } from "../items/item-url";
import { inlineTagSpans } from "../knowledge/tag-grammar";
import { clipSnippet } from "../text/clip-text";
import { sameJson, utf8ByteLength } from "./canonical-json";
import { ITEM_FIELD_CAPS } from "./library-item";
import type { LibraryItemFields } from "./library-item";
import { collectFileShas } from "./library-nodes";
import type { LibraryBlock, LibraryElement, LibraryNode, LibrarySection } from "./library-nodes";

const PREVIEW_MAX = 140;
const SHOWN_LINE_MAX = 100;
const OUTLINE_MAX = 200;

export interface BodyBlock {
  readonly block: LibraryBlock;
  readonly section: LibrarySection;
}

export const sameBody = (a: readonly BodyBlock[], b: readonly BodyBlock[]) =>
  a.length === b.length &&
  a.every((one, at) => {
    const other = b[at];

    return other !== undefined && one.section === other.section && sameJson(one.block, other.block);
  });

type DerivedLink =
  | { readonly targetId: string; readonly targetKey: null }
  | { readonly targetId: null; readonly targetKey: string };

interface DerivedTag {
  readonly tag: string;
  readonly origin: "field" | "inline";
}

interface OutlineEntry {
  readonly blockId: string;
  readonly level: 1 | 2 | 3;
  readonly text: string;
}

export interface ItemCard {
  readonly title: string;
  readonly preview: string;
  readonly outline: readonly OutlineEntry[];
  readonly words: number;
}

export const itemCardSchema = z.object({
  outline: z.array(
    z.object({
      blockId: z.string(),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      text: z.string(),
    }),
  ),
  preview: z.string(),
  title: z.string(),
  words: z.number().int().nonnegative(),
}) satisfies z.ZodType<ItemCard>;

interface ItemSearchText {
  readonly title: string;
  readonly headings: string;
  readonly meta: string;
  readonly body: string;
}

export interface BodyDigest {
  readonly lead: string;
  readonly preview: string;
  readonly outline: readonly OutlineEntry[];
  readonly words: number;
  readonly headings: string;
  readonly tags: readonly string[];
  readonly files: readonly string[];
  readonly article: boolean;
}

export interface DerivedBody {
  readonly digest: BodyDigest;
  readonly links: readonly DerivedLink[];
  readonly text: string;
  readonly textBytes: number;
}

export interface DerivedItem {
  readonly urlKey: string | null;
  readonly card: ItemCard;
  readonly tags: readonly DerivedTag[];
  readonly search: Omit<ItemSearchText, "body">;
}

export const titleKey = (title: string) => title.normalize("NFC").trim().toLowerCase();

const isText = (node: LibraryNode): node is Extract<LibraryNode, { text: string }> =>
  "text" in node;

const INLINE_TYPES = new Set<string>(["a", "date", "formulaPill", "inline_equation", "mention"]);

const isInline = (node: LibraryNode) => isText(node) || INLINE_TYPES.has(node.type);

const SILENT_TYPES = new Set<string>([
  "canvas_block",
  "chart_block",
  "hr",
  "html_block",
  "media_embed",
  "video",
]);

const standInText = (element: LibraryElement) => {
  if (SILENT_TYPES.has(element.type)) {
    return "";
  }

  switch (element.type) {
    case "mention": {
      return element.value;
    }

    case "date": {
      return element.date;
    }

    case "formulaPill": {
      return element.display;
    }

    case "inline_equation":
    case "equation": {
      return element.texExpression;
    }

    case "img": {
      return (element.caption ?? []).map((leaf) => leaf.text).join("");
    }

    case "file": {
      return element.name ?? "";
    }

    default: {
      return null;
    }
  }
};

const joinChildren = (children: readonly LibraryNode[], read: (node: LibraryNode) => string) => {
  const lines: string[] = [];
  let run: string | null = null;

  for (const child of children) {
    if (isInline(child)) {
      run = (run ?? "") + read(child);
      continue;
    }

    if (run !== null) {
      lines.push(run);
      run = null;
    }

    lines.push(read(child));
  }

  if (run !== null) {
    lines.push(run);
  }

  return lines.join("\n");
};

const ZWSP = /​/gu;

const nodeText: (node: LibraryNode) => string = (node: LibraryNode) => {
  if (isText(node)) {
    return node.text.replaceAll(ZWSP, "");
  }

  const standIn = standInText(node);

  if (standIn !== null) {
    return standIn;
  }

  if (node.type === "tr") {
    return node.children.map(nodeText).join("\t");
  }

  const text = joinChildren(node.children, nodeText);

  return node.type === "tab_panel" ? `${node.label}\n${text}` : text;
};

const visitElements = (nodes: readonly LibraryNode[], visit: (node: LibraryElement) => void) => {
  for (const node of nodes) {
    if (!isText(node)) {
      visit(node);
      visitElements(node.children, visit);
    }
  }
};

export const tagSpansIn = (text: string) =>
  inlineTagSpans(text).filter(({ tag }) => tag.length <= ITEM_FIELD_CAPS.line);

const LITERAL_TYPES = new Set<string>(["a", "code_block", "code_line"]);

const textTags = (node: LibraryNode, literal: boolean, into: DerivedTag[]) => {
  if (isText(node)) {
    if (!literal && node.code !== true) {
      for (const span of tagSpansIn(node.text)) {
        into.push({ origin: "inline", tag: span.tag });
      }
    }

    return;
  }

  const inner = literal || LITERAL_TYPES.has(node.type);

  for (const child of node.children) {
    textTags(child, inner, into);
  }
};

const WORD = /\S+/gu;

const unique = <T>(items: readonly T[], keyOf: (item: T) => string) => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = keyOf(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
};

const firstLine = (text: string) => text.trim().split("\n", 1)[0]?.trim() ?? "";

const leadOf = (headings: readonly string[], texts: readonly string[]) => {
  const heading = headings.find((text) => text.trim() !== "");
  const line = heading ?? texts.map(firstLine).find((text) => text !== "") ?? "";

  return clipSnippet(firstLine(line), SHOWN_LINE_MAX);
};

const metaOf = (fields: LibraryItemFields, tags: readonly DerivedTag[]) =>
  [
    fields.url === null ? "" : urlSearchText(fields.url),
    fields.site,
    fields.author,
    fields.description,
    ...unique(tags, (tag) => tag.tag.toLowerCase()).map((tag) => tag.tag),
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join("\n");

const OUTLINE_LEVELS = new Map<string, OutlineEntry["level"]>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
]);

const HEADING_TYPES = new Set<string>(["h1", "h2", "h3", "h4", "h5", "h6"]);

const HEADINGS_MAX = 64 * 1024;

export const cardPreview = (blocks: readonly LibraryBlock[]) => {
  for (const block of blocks) {
    if (block.type === "p" && block.listStyleType === undefined) {
      const preview = clipSnippet(nodeText(block).trim(), PREVIEW_MAX);

      if (preview !== "") {
        return preview;
      }
    }
  }

  return "";
};

export const deriveBody = (blocks: readonly BodyBlock[]) => {
  const links: DerivedLink[] = [];
  const inlineTags: DerivedTag[] = [];
  const outline: OutlineEntry[] = [];
  const headings: string[] = [];
  const texts: string[] = [];
  const files = new Set<string>();
  let words = 0;
  let article = false;

  for (const { block, section } of blocks) {
    if (section === "note") {
      textTags(block, false, inlineTags);
    } else {
      article = true;
    }

    collectFileShas(block, files);
    const text = nodeText(block);
    texts.push(text);
    words += text.match(WORD)?.length ?? 0;

    if (HEADING_TYPES.has(block.type)) {
      headings.push(text);
    }

    const level = OUTLINE_LEVELS.get(block.type);

    if (level !== undefined && outline.length < OUTLINE_MAX) {
      outline.push({ blockId: block.id, level, text: clipSnippet(text, SHOWN_LINE_MAX) });
    }

    visitElements([block], (node) => {
      switch (node.type) {
        case "mention": {
          links.push({ targetId: node.key, targetKey: null });
          break;
        }

        case "a": {
          const key = urlKey(node.url);

          if (key !== null) {
            links.push({ targetId: null, targetKey: key });
          }

          break;
        }

        default: {
          break;
        }
      }
    });
  }

  const text = texts.join("\n");

  return {
    digest: {
      article,
      files: [...files],
      headings: clipSnippet(headings.join("\n"), HEADINGS_MAX),
      lead: leadOf(headings, texts),
      outline,
      preview: cardPreview(blocks.map(({ block }) => block)),
      tags: unique(inlineTags, (tag) => tag.tag.toLowerCase()).map((tag) => tag.tag),
      words,
    },
    links,
    text,
    textBytes: utf8ByteLength(text),
  } satisfies DerivedBody;
};

const unnamedTitle = (fields: LibraryItemFields, digest: BodyDigest) =>
  fields.url === null ? digest.lead : itemNameFromUrl(fields.url);

export const deriveItem = (fields: LibraryItemFields, digest: BodyDigest) => {
  const tags = [
    ...unique(
      fields.tags.map((tag) => ({ origin: "field", tag }) satisfies DerivedTag),
      (tag) => tag.tag.toLowerCase(),
    ),
    ...digest.tags.map((tag) => ({ origin: "inline", tag }) satisfies DerivedTag),
  ];

  const named = fields.title.trim();
  const title = named === "" ? unnamedTitle(fields, digest) : named;

  return {
    card: { outline: [...digest.outline], preview: digest.preview, title, words: digest.words },
    search: {
      headings: [digest.headings, ...fields.aliases].filter((line) => line !== "").join("\n"),
      meta: metaOf(fields, tags),
      title,
    },
    tags,
    urlKey: fields.url === null ? null : urlKey(fields.url),
  } satisfies DerivedItem;
};
