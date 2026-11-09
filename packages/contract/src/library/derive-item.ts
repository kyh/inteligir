// What an item's rows say that no writer writes: its title as the library shows it, its card, its
// searchable text, and the links, tags and files its body holds. The body is read once, by
// whoever holds it (the cell for a body it keeps, a note's object for a live one), into its text
// and a digest the item's row keeps; the card and the index text are the fields over that digest,
// so a write of the fields alone derives them again without the body. The card rides the item's
// row, so a listing draws an item without its body.

import { z } from "zod";

import { urlKey, urlSearchText } from "../items/item-url";
import { inlineTagSpans } from "../knowledge/tag-grammar";
import { clipSnippet } from "../text/clip-text";
import { utf8ByteLength } from "./canonical-json";
import type { LibraryItemFields } from "./library-item";
import { collectFileShas } from "./library-nodes";
import type { LibraryBlock, LibraryElement, LibraryNode, LibrarySection } from "./library-nodes";

// a card's preview: the first paragraph's text, cut short
const PREVIEW_MAX = 140;
// a line the card shows of the body (a title read from it, a heading in its outline), cut shorter
const SHOWN_LINE_MAX = 100;
// the headings a card's outline keeps, from the top: the card rides in the item's row, which a
// Durable Object caps at 2 MB, and a heading block may hold half a megabyte
const OUTLINE_MAX = 200;

// a top-level block of an item's body, in reading order: the person's note or the page a fill read
export interface BodyBlock {
  readonly block: LibraryBlock;
  readonly section: LibrarySection;
}

// an item a page link names, or a url's key, so an item saved from that address finds the
// notes that linked it
export type DerivedLink =
  | { readonly targetId: string; readonly targetKey: null }
  | { readonly targetId: null; readonly targetKey: string };

// a field tag is one the item's tags list names; an inline one a `#name` in its note's text
export interface DerivedTag {
  readonly tag: string;
  readonly origin: "field" | "inline";
}

interface OutlineEntry {
  readonly blockId: string;
  readonly level: 1 | 2 | 3;
  readonly text: string;
}

export interface ItemCard {
  // the item's name, or when it has none its first heading's or line's text
  readonly title: string;
  // the first paragraph's text, at most PREVIEW_MAX; "" when none holds any
  readonly preview: string;
  // the h1 to h3 headings, the levels the editor's table of contents draws (its toc.tsx): the
  // first OUTLINE_MAX, each cut to SHOWN_LINE_MAX
  readonly outline: readonly OutlineEntry[];
  readonly words: number;
}

// a card as a row holds it and an answer carries it, read leniently: a newer writer's extra field
// is dropped, never refused
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

// the four literal columns the ranked index reads (`@repo/service/knowledge/search-query`)
export interface ItemSearchText {
  readonly title: string;
  readonly headings: string;
  readonly meta: string;
  readonly body: string;
}

// what the item's row keeps of its body: what its card and index text need beside the fields, and
// what its rows of tags and files are rewritten from when only the fields change
export interface BodyDigest {
  // the first heading's text, else the first line's, cut to a line: the title of an item with none
  readonly lead: string;
  readonly preview: string;
  readonly outline: readonly OutlineEntry[];
  readonly words: number;
  // every heading's text, a line each, cut to what the index row holds of them
  readonly headings: string;
  // the `#name`s the note's text holds, each once
  readonly tags: readonly string[];
  // the files the body embeds, by sha
  readonly files: readonly string[];
  // whether the body holds a page a fill or a device read
  readonly article: boolean;
}

export const bodyDigestSchema = z.object({
  article: z.boolean(),
  files: z.array(z.string()),
  headings: z.string(),
  lead: z.string(),
  outline: itemCardSchema.shape.outline,
  preview: z.string(),
  tags: z.array(z.string()),
  words: z.number().int().nonnegative(),
}) satisfies z.ZodType<BodyDigest>;

export const EMPTY_DIGEST: BodyDigest = {
  article: false,
  files: [],
  headings: "",
  lead: "",
  outline: [],
  preview: "",
  tags: [],
  words: 0,
};

export interface DerivedBody {
  readonly digest: BodyDigest;
  readonly links: readonly DerivedLink[];
  // the body's text, each block's lines after the last's: what the literal tier matches and the
  // index's body column is cut from
  readonly text: string;
  // that text as UTF-8: what the cell's cap on a kept body counts
  readonly textBytes: number;
}

export interface DerivedItem {
  readonly urlKey: string | null;
  readonly card: ItemCard;
  readonly tags: readonly DerivedTag[];
  // the index's columns but the body's, which is the body's own text
  readonly search: Omit<ItemSearchText, "body">;
}

// what a `[[Title]]` resolves by: the key an item's title and aliases are filed under
export const titleKey = (title: string): string => title.normalize("NFC").trim().toLowerCase();

const isText = (node: LibraryNode): node is Extract<LibraryNode, { text: string }> =>
  "text" in node;

const INLINE_TYPES = new Set<string>(["a", "date", "formulaPill", "inline_equation", "mention"]);

const isInline = (node: LibraryNode): boolean => isText(node) || INLINE_TYPES.has(node.type);

// the voids that read as nothing: a rich block's source is not prose, and media has none
const SILENT_TYPES = new Set<string>([
  "canvas_block",
  "chart_block",
  "hr",
  "html_block",
  "media_embed",
  "video",
]);

// what a void element reads as, or null for an element its children's text speaks for
const standInText = (element: LibraryElement): string | null => {
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

// a run of inline children reads as one line, and each block child as a line of its own
const joinChildren = (
  children: readonly LibraryNode[],
  read: (node: LibraryNode) => string,
): string => {
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

// the line markdown writes an empty paragraph as, which holds no word
const ZWSP = /​/gu;

// a table row's cells read tab-separated, a tab panel under its label
const nodeText = (node: LibraryNode): string => {
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

// where a `#name` is the text it is and never a tag: code and a link's label, as the editor reads it
// (`packages/editor/src/kits/tag-chip-kit.tsx`)
const LITERAL_TYPES = new Set<string>(["a", "code_block", "code_line"]);

// the tags the person's text names, read leaf by leaf as the editor draws its chips: a page a
// fill read keeps its `#` as the page wrote it, so only the note's section is read
const textTags = (node: LibraryNode, literal: boolean, into: DerivedTag[]): void => {
  if (isText(node)) {
    if (!literal && node.code !== true) {
      for (const span of inlineTagSpans(node.text)) {
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

const unique = <T>(items: readonly T[], keyOf: (item: T) => string): T[] => {
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

const firstLine = (text: string): string => text.trim().split("\n", 1)[0]?.trim() ?? "";

const leadOf = (headings: readonly string[], texts: readonly string[]): string => {
  const heading = headings.find((text) => text.trim() !== "");
  const line = heading ?? texts.map(firstLine).find((text) => text !== "") ?? "";
  return clipSnippet(firstLine(line), SHOWN_LINE_MAX);
};

const metaOf = (fields: LibraryItemFields, tags: readonly DerivedTag[]): string =>
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

// every heading ranks as one, at every depth
const HEADING_TYPES = new Set<string>(["h1", "h2", "h3", "h4", "h5", "h6"]);

// what the digest keeps of the headings, a sixteenth of what the item's 2 MB row could hold at
// three bytes a unit; the index row clips them again with the rest
const HEADINGS_MAX = 64 * 1024;

export const deriveBody = (blocks: readonly BodyBlock[]): DerivedBody => {
  const links: DerivedLink[] = [];
  const inlineTags: DerivedTag[] = [];
  const outline: OutlineEntry[] = [];
  const headings: string[] = [];
  const texts: string[] = [];
  const files = new Set<string>();
  let preview = "";
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
    if (preview === "" && block.type === "p" && block.listStyleType === undefined) {
      preview = clipSnippet(text.trim(), PREVIEW_MAX);
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
      preview,
      tags: unique(inlineTags, (tag) => tag.tag.toLowerCase()).map((tag) => tag.tag),
      words,
    },
    links,
    text,
    textBytes: utf8ByteLength(text),
  };
};

export const deriveItem = (fields: LibraryItemFields, digest: BodyDigest): DerivedItem => {
  const tags = [
    ...unique(
      fields.tags.map((tag): DerivedTag => ({ origin: "field", tag })),
      (tag) => tag.tag.toLowerCase(),
    ),
    ...digest.tags.map((tag): DerivedTag => ({ origin: "inline", tag })),
  ];
  const named = fields.title.trim();
  const title = named === "" ? digest.lead : named;
  return {
    card: { outline: [...digest.outline], preview: digest.preview, title, words: digest.words },
    search: {
      headings: [digest.headings, ...fields.aliases].filter((line) => line !== "").join("\n"),
      meta: metaOf(fields, tags),
      title,
    },
    tags,
    urlKey: fields.url === null ? null : urlKey(fields.url),
  };
};
