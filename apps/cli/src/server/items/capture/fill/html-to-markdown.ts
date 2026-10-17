// an article's html as markdown under the dialect's rules, in three rungs from rich to plain. The
// page is hostile input: every text node is escaped so nothing in it reads back as a construct the
// dialect owns (a formula pill, a date chip, an annotation marker, a container line, math, inline
// html, an entity, a strikethrough or a wiki link), and nothing but text, links, pictures, code,
// lists, quotes and tables is ever written.

import TurndownService from "turndown";

export type Rung = "rich" | "plain" | "text";

// the rungs turndown writes; the text rung is a walk of its own (plainText)
type MarkupRung = Exclude<Rung, "text">;

// every ASCII character the dialect or CommonMark could read as syntax; a backslash before ASCII
// punctuation is always a literal, and the canonicalizer re-spells the escapes it keeps
const ESCAPED = /[\\`*_{}[\]<>()#+\-.!|~$&%:@=^"']/gu;

export const escapeText = (text: string): string =>
  text.replaceAll(ESCAPED, (character) => `\\${character}`);

// elements whose text is never the article's
const DROPPED = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "SVG",
  "BUTTON",
  "FORM",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "DIALOG",
  "HEAD",
]);

const STRUCK = new Set(["DEL", "S", "STRIKE"]);

const isElement = (node: Node): node is HTMLElement => node.nodeType === 1;

const childElements = (node: HTMLElement, name: string): HTMLElement[] =>
  [...node.children].filter(
    (child): child is HTMLElement => isElement(child) && child.nodeName === name,
  );

// a table GFM can spell: rows of plain cells, no spans, no block content inside a cell
const isSimpleTable = (table: HTMLElement): boolean => {
  const cells = [...table.querySelectorAll("td, th")];
  if (cells.length === 0 || table.querySelector("table table") !== null) {
    return false;
  }
  return cells.every(
    (cell) =>
      (cell.getAttribute("colspan") ?? "1") === "1" &&
      (cell.getAttribute("rowspan") ?? "1") === "1" &&
      cell.querySelector("p, div, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6, img") ===
        null,
  );
};

const rowsOf = (table: HTMLElement): HTMLTableRowElement[] => [...table.querySelectorAll("tr")];

const cellText = (cell: Element): string =>
  escapeText((cell.textContent ?? "").replaceAll(/\s+/gu, " ").trim());

const gfmTable = (table: HTMLElement): string => {
  const rows = rowsOf(table).map((row) =>
    [...row.children].filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH"),
  );
  const width = Math.max(...rows.map((row) => row.length));
  if (width === 0) {
    return "";
  }
  const line = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
  const [head = [], ...body] = rows;
  return [
    line(head.map(cellText)),
    line(Array.from({ length: width }, () => "---")),
    ...body.map((row) => line(row.map(cellText))),
  ].join("\n");
};

// a table as one paragraph a row, its cells joined: the plain rungs keep every word of it
const flatTable = (table: HTMLElement): string =>
  rowsOf(table)
    .map((row) =>
      [...row.children]
        .map(cellText)
        .filter((text) => text !== "")
        .join(" · "),
    )
    .filter((row) => row !== "")
    .join("\n\n");

const codeLanguage = (pre: HTMLElement): string => {
  const [code] = childElements(pre, "CODE");
  const classes = `${code?.getAttribute("class") ?? ""} ${pre.getAttribute("class") ?? ""}`;
  return /(?:^|\s)(?:language|lang)-(?<lang>[\w+#-]{1,32})/u.exec(classes)?.groups?.lang ?? "";
};

// a fence longer than any backtick run inside, so the code cannot close it
const fenceFor = (code: string): string => {
  const longest = Math.max(2, ...[...code.matchAll(/`+/gu)].map((run) => run[0].length));
  return "`".repeat(longest + 1);
};

const fencedCode = (pre: HTMLElement): string => {
  const code = (pre.textContent ?? "").replace(/\n$/u, "");
  const fence = fenceFor(code);
  return `\n\n${fence}${codeLanguage(pre)}\n${code}\n${fence}\n\n`;
};

const webHref = (raw: string | null): string | null =>
  raw !== null && /^https?:\/\//iu.test(raw) ? raw : null;

// a link destination with nothing in it the dialect could read as anything else
const destination = (url: string): string => url.replaceAll(/[\s<>()\\]/gu, encodeURIComponent);

const serviceFor = (rung: MarkupRung): TurndownService => {
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    fence: "```",
    headingStyle: "atx",
    hr: "---",
    linkStyle: "inlined",
    strongDelimiter: "**",
  });
  service.escape = escapeText;
  service.remove((node) => DROPPED.has(node.nodeName.toUpperCase()));

  service.addRule("fencedCode", {
    filter: (node) => node.nodeName === "PRE",
    replacement: (_content, node) => fencedCode(node),
  });

  service.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const spelled = rung === "rich" && isSimpleTable(node) ? gfmTable(node) : flatTable(node);
      return spelled === "" ? "" : `\n\n${spelled}\n\n`;
    },
  });

  service.addRule("strikethrough", {
    filter: (node) => STRUCK.has(node.nodeName),
    replacement: (content) => (content.trim() === "" ? content : `~~${content}~~`),
  });

  service.addRule("link", {
    filter: (node) => node.nodeName === "A",
    replacement: (content, node) => {
      const href = webHref(node.getAttribute("href"));
      if (href === null || content.trim() === "") {
        return content;
      }
      return `[${content}](${destination(href)})`;
    },
  });

  service.addRule("image", {
    filter: "img",
    replacement: (_content, node) => {
      const src = webHref(node.getAttribute("src"));
      const alt = escapeText((node.getAttribute("alt") ?? "").replaceAll(/\s+/gu, " ").trim());
      if (rung !== "rich" || src === null) {
        return alt;
      }
      return `![${alt}](${destination(src)})`;
    },
  });

  return service;
};

const SERVICES = new Map<MarkupRung, TurndownService>();

// elements that end the paragraph the text walk is gathering
const BLOCKS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

// the last rung: every block's words as an escaped paragraph, walked with a stack of its own so a
// page nested past any recursion still reads
const plainText = (root: HTMLElement): string => {
  const paragraphs: string[] = [];
  let current = "";
  const flush = (): void => {
    const text = current.replaceAll(/\s+/gu, " ").trim();
    if (text !== "") {
      paragraphs.push(escapeText(text));
    }
    current = "";
  };
  const pending: (Node | "end")[] = [...root.childNodes].toReversed();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node === "end") {
      flush();
      continue;
    }
    if (node.nodeType === 3) {
      current += node.nodeValue ?? "";
      continue;
    }
    if (!isElement(node) || DROPPED.has(node.nodeName.toUpperCase())) {
      continue;
    }
    if (BLOCKS.has(node.nodeName)) {
      flush();
      pending.push("end");
    }
    pending.push(...[...node.childNodes].toReversed());
  }
  flush();
  return paragraphs.length === 0 ? "" : `${paragraphs.join("\n\n")}\n`;
};

export const htmlToMarkdown = (root: HTMLElement, rung: Rung): string => {
  if (rung === "text") {
    return plainText(root);
  }
  let service = SERVICES.get(rung);
  if (service === undefined) {
    service = serviceFor(rung);
    SERVICES.set(rung, service);
  }
  return service.turndown(root);
};
