// A page's readable part as the tree the editor reads: its html parsed to hast, cut to the
// article's budget between whole blocks, and written as mdast. The page is hostile input: its text
// stays text nodes no reader parses again, so nothing in it reads as a construct the dialect owns,
// and nothing but text, links, pictures, code, lists, quotes and tables is ever written.

import type { Element, Parents, Root as HastRoot, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultHandlers, toMdast } from "hast-util-to-mdast";
import type { Handle, NodeHandle } from "hast-util-to-mdast";
import type { Paragraph, Root, Table } from "mdast";

import { FILL_LIMITS } from "@repo/contract/items/link-fill";
import { RICH_FENCE_LANGS } from "@repo/editor/headless/markdown/fence-langs";

import { DROPPED, HAST, plainParagraph, wordsOf } from "./page-words";
import { resolveWebUrl } from "./web-url";

// an element that holds only elements (a section, a list, a table's body): a cut may fall between
// its children; a paragraph, a heading or a list item holds text of its own, which a cut keeps whole
const isWrapper = (element: Element): boolean =>
  element.children.some((child) => child.type === "element") &&
  element.children.every(
    (child) => child.type === "element" || (child.type === "text" && child.value.trim() === ""),
  );

// an element that ends where its last child does never read its end tag: the cut left it open
const leftOpen = (element: Element): boolean => {
  const tail = element.children.at(-1);
  return tail !== undefined && tail.position?.end.offset === element.position?.end.offset;
};

// the block the cut fell in goes: the innermost one it left open, a wrapper losing only its own
const dropCutBlock = (tree: HastRoot): void => {
  let parent: Parents = tree;
  for (;;) {
    const last: RootContent | undefined = parent.children.at(-1);
    if (last?.type !== "element" || !leftOpen(last)) {
      return;
    }
    if (!isWrapper(last)) {
      parent.children.pop();
      return;
    }
    parent = last;
  }
};

// The readable part's leading markup within the article's budget, as hast. The cut is made in the
// string, at a tag's start, before anything is parsed, since a tree costs heap by its markup's
// length (36 MB a MiB), which no host can give a page of any length; the parser closes what the
// cut left open.
export const articleTree = (html: string): HastRoot => {
  if (html.length <= FILL_LIMITS.articleBytes) {
    return fromHtml(html, { fragment: true });
  }
  const cut = Math.max(0, html.lastIndexOf("<", FILL_LIMITS.articleBytes));
  const tree = fromHtml(html.slice(0, cut), { fragment: true });
  dropCutBlock(tree);
  return tree;
};

// every element under one, in the page's order
const within = (root: Element): Element[] => {
  const found: Element[] = [];
  const pending = root.children.toReversed();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.type === "element") {
      found.push(next);
      pending.push(...next.children.toReversed());
    }
  }
  return found;
};

const isCell = (element: Element): boolean => element.tagName === "td" || element.tagName === "th";

const CELL_BLOCKS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "pre",
  "blockquote",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
]);

// a table GFM can spell: rows of plain cells, no spans, no block content inside a cell
const isSimpleTable = (table: Element): boolean => {
  const cells = within(table).filter(isCell);
  return (
    cells.length > 0 &&
    cells.every(
      (cell) =>
        (cell.properties.colSpan ?? 1) === 1 &&
        (cell.properties.rowSpan ?? 1) === 1 &&
        !within(cell).some((inner) => CELL_BLOCKS.has(inner.tagName)),
    )
  );
};

// a table as one paragraph a row, its cells joined, which keeps every word of one GFM cannot spell
const rowParagraphs = (table: Element): Paragraph[] =>
  within(table)
    .filter((element) => element.tagName === "tr")
    .map((row) =>
      row.children
        .map((cell) => wordsOf(cell, HAST).join(" "))
        .filter((text) => text !== "")
        .join(" · "),
    )
    .filter((line) => line !== "")
    .map(plainParagraph);

// The editor draws a table's first row as its head, so the empty row the stock handler heads a
// table of plain rows with goes, and that table's first row heads it.
const headedByFirstRow = (table: Table): Table => {
  const [head, ...rows] = table.children;
  const empty = head?.children.every((cell) => cell.children.length === 0) ?? false;
  return empty && rows.length > 0 ? { ...table, children: rows } : table;
};

const drop: Handle & NodeHandle = () => [];

const handlersFor = (pageUrl: string) =>
  ({
    ...Object.fromEntries([...DROPPED].map((tag) => [tag, drop])),

    // http and https alone, absolute against the page; an in-page or script link is its text. A
    // link holds words, so a picture in one stands before it, where the editor's link would lose it
    a: (state, node) => {
      const link = defaultHandlers.a(state, node);
      const url = resolveWebUrl(link.url, pageUrl);
      const words = link.children.filter((child) => child.type !== "image");
      if (url === null || words.length === 0) {
        return link.children;
      }
      const pictures = link.children.filter((child) => child.type === "image");
      return [...pictures, { ...link, children: words, url }];
    },

    // a page's links resolve against the address it was read at, never a `<base>` of its own, which
    // the stock handlers resolve by with a `new URL` that throws
    base: drop,

    // a picture's own address, never an inline placeholder; one with no address is its alt
    img: (state, node) => {
      const image = defaultHandlers.img(state, node);
      const url = resolveWebUrl(image.url, pageUrl);
      if (url !== null) {
        return { ...image, url };
      }
      const alt = image.alt ?? "";
      return alt === "" ? [] : { type: "text", value: alt };
    },

    // a formula's words, as the page's text
    math: (state, node) => state.all(node),

    // the page's own name for its code's language, unless it names one of the dialect's own fenced
    // blocks (a chart, a canvas, a runnable html block): a page's code stays code
    pre: (state, node) => {
      const code = defaultHandlers.pre(state, node);
      return RICH_FENCE_LANGS.has((code.lang ?? "").toLowerCase()) ? { ...code, lang: null } : code;
    },

    table: (state, node) => {
      if (!isSimpleTable(node)) {
        return rowParagraphs(node);
      }
      const table = defaultHandlers.table(state, node);
      return table.type === "table" ? headedByFirstRow(table) : table;
    },
  }) satisfies Record<string, Handle>;

// the tree as the mdast the editor's rules read, its links and pictures absolute against the page
export const articleMdast = (tree: HastRoot, pageUrl: string): Root => {
  const written = toMdast(tree, {
    document: true,
    handlers: handlersFor(pageUrl),
    nodeHandlers: { comment: drop },
  });
  if (written.type !== "root") {
    throw new Error("hast-util-to-mdast wrote a root as something else");
  }
  return written;
};
