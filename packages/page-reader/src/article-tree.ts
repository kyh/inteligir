import type { Element, Parents, Root as HastRoot, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultHandlers, toMdast } from "hast-util-to-mdast";
import type { Handle, NodeHandle, State } from "hast-util-to-mdast";
import type { BlockContent, DefinitionContent, Table } from "mdast";

import { FILL_LIMITS } from "@repo/contract/items/link-fill";
import { RICH_FENCE_LANGS } from "@repo/editor/headless/markdown/fence-langs";

import { DROPPED, HAST, plainParagraph, wordsOf } from "./page-words";
import { resolveWebUrl } from "./web-url";

const isWrapper = (element: Element) =>
  element.children.some((child) => child.type === "element") &&
  element.children.every(
    (child) => child.type === "element" || (child.type === "text" && child.value.trim() === ""),
  );

const leftOpen = (element: Element) => {
  const tail = element.children.at(-1);

  return tail !== undefined && tail.position?.end.offset === element.position?.end.offset;
};

const dropCutBlock = (tree: HastRoot) => {
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

export const articleTree = (html: string) => {
  if (html.length <= FILL_LIMITS.articleBytes) {
    return fromHtml(html, { fragment: true });
  }

  const cut = Math.max(0, html.lastIndexOf("<", FILL_LIMITS.articleBytes));
  const tree = fromHtml(html.slice(0, cut), { fragment: true });
  dropCutBlock(tree);

  return tree;
};

const within = (root: Element) => {
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

const isCell = (element: Element) => element.tagName === "td" || element.tagName === "th";

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

const isSimpleTable = (table: Element) => {
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

const rowParagraphs = (table: Element) =>
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

const headedByFirstRow = (table: Table) => {
  const [head, ...rows] = table.children;
  const empty = head?.children.every((cell) => cell.children.length === 0) ?? false;

  return (empty && rows.length > 0 ? { ...table, children: rows } : table) satisfies Table;
};

const captionOf = (state: State, table: Element) => {
  const caption = table.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "caption",
  );

  return (caption === undefined ? [] : state.toFlow(state.all(caption))) satisfies (
    | BlockContent
    | DefinitionContent
  )[];
};

const drop: Handle & NodeHandle = () => [];

const handlersFor = (pageUrl: string) =>
  ({
    ...Object.fromEntries([...DROPPED].map((tag) => [tag, drop])),

    a: (state, node) => {
      const link = defaultHandlers.a(state, node);
      const url = resolveWebUrl(link.url, pageUrl);

      return url === null ? link.children : { ...link, url };
    },

    base: drop,

    img: (state, node) => {
      const image = defaultHandlers.img(state, node);
      const url = resolveWebUrl(image.url, pageUrl);

      if (url !== null) {
        return { ...image, url };
      }

      const alt = image.alt ?? "";

      return alt === "" ? [] : { type: "text", value: alt };
    },

    math: (state, node) => state.all(node),

    pre: (state, node) => {
      const code = defaultHandlers.pre(state, node);

      return RICH_FENCE_LANGS.has((code.lang ?? "").toLowerCase()) ? { ...code, lang: null } : code;
    },

    table: (state, node) => {
      const caption = captionOf(state, node);

      if (!isSimpleTable(node)) {
        return [...caption, ...rowParagraphs(node)];
      }

      const table = defaultHandlers.table(state, node);

      return [...caption, table.type === "table" ? headedByFirstRow(table) : table];
    },
  }) satisfies Record<string, Handle>;

export const articleMdast = (tree: HastRoot, pageUrl: string) => {
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
