// What an item's rows say that no writer writes: its title as the library shows it, its card, its
// searchable text, the links and tags its blocks hold and the highlights each block anchors. One
// walk over the fields and the blocks in reading order, in the same transaction as the write, on
// the cell and on every replica alike, so nothing derived is ever synced or stale.

import { urlKey, urlSearchText } from "../items/item-url";
import { clipSnippet } from "../text/clip-text";
import { orderedBlocks } from "./block-ops";
import type { StoredBlock } from "./block-ops";
import { utf8ByteLength } from "./canonical-json";
import type { LibraryItemFields } from "./library-item";
import type { LibraryElement, LibraryNode, LibrarySection } from "./library-nodes";

// a card's preview: the first paragraph's text, cut short
const PREVIEW_MAX = 140;
// a title read from the body: its first line, cut shorter
const BODY_TITLE_MAX = 100;

export const LIBRARY_LINK_KINDS = ["wiki", "embed", "url"] as const;
export type LibraryLinkKind = (typeof LIBRARY_LINK_KINDS)[number];

// `targetId` when the link names an item; `targetKey` what resolves it otherwise: a wiki link's
// title folded, so a dangling one resolves when an item answers to it, or a url's key, so an item
// saved from that address finds the notes that linked it
export interface DerivedLink {
  readonly blockId: string;
  readonly section: LibrarySection;
  readonly kind: LibraryLinkKind;
  readonly targetId: string | null;
  readonly targetKey: string | null;
  readonly heading: string | null;
  readonly blockRef: string | null;
}

// a field tag is one the item's tags list names; an inline one is a tag chip in its body
export interface DerivedTag {
  readonly tag: string;
  readonly origin: "field" | "inline";
}

export interface OutlineEntry {
  readonly blockId: string;
  readonly level: 1 | 2 | 3;
  readonly text: string;
}

export interface ItemCard {
  // the item's name, or when it has none its first heading's or line's text
  readonly title: string;
  // the first paragraph's text, at most PREVIEW_MAX; "" when none holds any
  readonly preview: string;
  readonly outline: readonly OutlineEntry[];
  readonly words: number;
}

export interface DerivedBlock {
  readonly text: string;
  readonly annotationIds: readonly string[];
}

// the four literal columns the ranked index reads (`@repo/notes/knowledge/search-query`)
export interface ItemSearchText {
  readonly title: string;
  readonly headings: string;
  readonly meta: string;
  readonly body: string;
}

export interface DerivedItem {
  readonly urlKey: string | null;
  readonly card: ItemCard;
  readonly links: readonly DerivedLink[];
  readonly tags: readonly DerivedTag[];
  readonly blocks: ReadonlyMap<string, DerivedBlock>;
  readonly search: ItemSearchText;
  // the body's text as UTF-8: what the cell's cap on an item's text counts
  readonly textBytes: number;
}

// what a wiki link's title resolves by: the key an item's title and aliases are filed under
export const titleKey = (title: string): string => title.normalize("NFC").trim().toLowerCase();

const isText = (node: LibraryNode): node is Extract<LibraryNode, { text: string }> =>
  "text" in node;

const INLINE_TYPES = new Set<string>([
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

const isInline = (node: LibraryNode): boolean => isText(node) || INLINE_TYPES.has(node.type);

// the voids that read as nothing: an embed's text is its target's, a marker's and a rich block's
// source is not prose, and media has none
const SILENT_TYPES = new Set<string>([
  "annotationMarker",
  "canvas_block",
  "chart_block",
  "hr",
  "html_block",
  "media_embed",
  "opaque",
  "video",
  "wikiEmbed",
]);

// what a void element reads as, or null for an element its children's text speaks for
const standInText = (element: LibraryElement): string | null => {
  if (SILENT_TYPES.has(element.type)) {
    return "";
  }
  switch (element.type) {
    case "wikiLink": {
      return element.alias ?? element.title;
    }
    case "tag": {
      return `#${element.value}`;
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

// a table row's cells read tab-separated, a tab panel under its label
const nodeText = (node: LibraryNode): string => {
  if (isText(node)) {
    return node.text;
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

const titleOf = (
  fields: LibraryItemFields,
  outline: readonly OutlineEntry[],
  texts: readonly string[],
): string => {
  const named = fields.title.trim();
  if (named !== "") {
    return named;
  }
  const heading = outline.find((entry) => entry.text.trim() !== "")?.text;
  const line = heading ?? texts.map(firstLine).find((text) => text !== "") ?? "";
  return clipSnippet(firstLine(line), BODY_TITLE_MAX);
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

const HEADING_LEVELS = { h1: 1, h2: 2, h3: 3 } as const;

export const deriveItem = (
  fields: LibraryItemFields,
  blocks: ReadonlyMap<string, StoredBlock>,
): DerivedItem => {
  const ordered = orderedBlocks(blocks);
  const derivedBlocks = new Map<string, DerivedBlock>();
  const links: DerivedLink[] = [];
  const inlineTags: DerivedTag[] = [];
  const outline: OutlineEntry[] = [];
  const texts: string[] = [];
  let preview = "";
  let words = 0;
  for (const { block, section } of ordered) {
    const text = nodeText(block);
    const annotationIds: string[] = [];
    texts.push(text);
    words += text.match(WORD)?.length ?? 0;
    if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
      outline.push({ blockId: block.id, level: HEADING_LEVELS[block.type], text });
    }
    if (preview === "" && block.type === "p" && block.listStyleType === undefined) {
      preview = clipSnippet(text.trim(), PREVIEW_MAX);
    }
    const link = (kind: LibraryLinkKind, target: Partial<DerivedLink>): void => {
      links.push({
        blockId: block.id,
        blockRef: target.blockRef ?? null,
        heading: target.heading ?? null,
        kind,
        section,
        targetId: target.targetId ?? null,
        targetKey: target.targetKey ?? null,
      });
    };
    visitElements([block], (node) => {
      switch (node.type) {
        case "wikiLink": {
          link("wiki", {
            blockRef: node.blockRef,
            heading: node.heading,
            targetId: node.itemId,
            targetKey: titleKey(node.title),
          });
          break;
        }
        case "wikiEmbed": {
          link("embed", { blockRef: node.blockRef, targetId: node.itemId });
          break;
        }
        case "a": {
          const key = urlKey(node.url);
          if (key !== null) {
            link("url", { targetKey: key });
          }
          break;
        }
        case "tag": {
          inlineTags.push({ origin: "inline", tag: node.value });
          break;
        }
        case "annotationMarker": {
          annotationIds.push(...node.ids.split(","));
          break;
        }
        default: {
          break;
        }
      }
    });
    derivedBlocks.set(block.id, { annotationIds: [...new Set(annotationIds)], text });
  }
  const tags = [
    ...unique(
      fields.tags.map((tag): DerivedTag => ({ origin: "field", tag })),
      (tag) => tag.tag.toLowerCase(),
    ),
    ...unique(inlineTags, (tag) => tag.tag.toLowerCase()),
  ];
  const title = titleOf(fields, outline, texts);
  const body = texts.join("\n");
  return {
    blocks: derivedBlocks,
    card: { outline, preview, title, words },
    links,
    search: {
      body,
      headings: [...outline.map((entry) => entry.text), ...fields.aliases].join("\n"),
      meta: metaOf(fields, tags),
      title,
    },
    tags,
    textBytes: utf8ByteLength(body),
    urlKey: fields.url === null ? null : urlKey(fields.url),
  };
};
