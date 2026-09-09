// The scan grammar (../markdown/scan-parse) is plain markdown and the editor's
// is not, so a `targetSpan` is emitted only where the raw bytes re-derive the
// parsed target and lie outside ../markdown/verbatim-spans; a link failing
// either is indexed but never rewritten.

import type { Nodes } from "mdast";

import { parseCalloutPayload } from "../markdown/callout-payload";
import { isCalloutLang } from "../markdown/fence-langs";
import { noteIdOf, parseProperties, PINNED_KEY } from "../markdown/frontmatter";
import type { ParsedProperties } from "../markdown/frontmatter";
import { parseWikiBodyRange } from "../markdown/remark-wiki-link";
import { parseScan } from "../markdown/scan-parse";
import { insideVerbatim, verbatimSpans } from "../markdown/verbatim-spans";
import type { VerbatimSpan } from "../markdown/verbatim-spans";
import { tasksInTree } from "./task-ordinal";
import type { ExtractedTask } from "./task-ordinal";

export interface Span {
  start: number;
  end: number;
}
export type LinkKind = "wiki" | "md" | "image";

export interface ExtractedLink {
  kind: LinkKind;
  embed: boolean;
  /** as written, percent-decoded for md links, anchor and alias stripped; never empty */
  target: string;
  anchor?: string;
  alias?: string;
  /** 1-based */
  line: number;
  targetSpan?: Span;
}

export interface DocScan {
  title: string | null;
  headings: string[];
  links: ExtractedLink[];
  tags: string[];
  aliases: string[];
  tasks: ExtractedTask[];
  pinned: boolean;
  noteId: string | null;
}

export interface InlineTagSpan {
  start: number;
  end: number;
  tag: string;
}

interface NodePosition {
  span: Span;
  line: number;
}

// the source, the ranges a span may not land in, and the scan every collector appends to
interface ScanContext {
  source: string;
  verbatim: readonly VerbatimSpan[];
  scan: DocScan;
}

// the name is letter-first (so `#123` and hex colors miss); one source string, so the inline
// grammar and the name a rename accepts cannot drift.
const TAG_NAME_SOURCE = String.raw`\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*`;
// `#` must not follow a word char, `#` or `/` (so `C#`, `##h` and url fragments miss).
// stateful `g` flag: use matchAll.
const INLINE_TAG_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_/#])#(${TAG_NAME_SOURCE})`, "gu");
const TAG_NAME_RE = new RegExp(`^(?:${TAG_NAME_SOURCE})$`, "u");

// anything with a scheme (`https:`, `mailto:`, `C:\…` alike) or protocol-relative `//` is external
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export const isTagName = (value: string): boolean => TAG_NAME_RE.test(value);

// shared with the editor's tag chip decoration; the token grammar must not drift between them
export const inlineTagSpans = (text: string): InlineTagSpan[] => {
  const spans: InlineTagSpan[] = [];
  for (const match of text.matchAll(INLINE_TAG_RE)) {
    const start = match.index;
    const [, raw] = match;
    if (start === undefined || raw === undefined) {
      continue;
    }
    // a trailing dash reads as punctuation (`#bar-` → `bar`)
    const tag = raw.replace(/-+$/u, "");
    if (tag === "") {
      continue;
    }
    spans.push({ end: start + 1 + tag.length, start, tag });
  }
  return spans;
};

const position = (node: Nodes): NodePosition | null => {
  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) {
    return null;
  }
  return { line: start.line, span: { end: end.offset, start: start.offset } };
};

const walk = (node: Nodes, visitor: (node: Nodes) => void): void => {
  visitor(node);
  if ("children" in node) {
    for (const child of node.children) {
      walk(child, visitor);
    }
  }
};

const textOf = (node: Nodes): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value;
  }
  if ("children" in node) {
    return node.children.map(textOf).join("");
  }
  return "";
};

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";

const safeDecode = (urlPath: string): string => {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return urlPath;
  }
};

// character references stay undecoded; such a destination fails verification and is never rewritten
const decodeMdEscapes = (raw: string): string =>
  raw.replaceAll(/\\(?<escaped>[!-/:-@[-`{-~])/gu, "$<escaped>");

const scanDestination = (source: string, from: number, end: number): Span | null => {
  let i = from;
  while (i < end && isSpace(source.charAt(i))) {
    i += 1;
  }
  if (i >= end) {
    return null;
  }
  if (source.charAt(i) === "<") {
    const close = source.indexOf(">", i + 1);
    if (close === -1 || close > end) {
      return null;
    }
    return { end: close, start: i + 1 };
  }
  const start = i;
  let depth = 0;
  while (i < end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (isSpace(c)) {
      break;
    }
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
    i += 1;
  }
  if (i > end || i <= start) {
    return null;
  }
  return { end: i, start };
};

const locateDestination = (source: string, lastEnd: number, end: number): Span | null => {
  if (source.slice(lastEnd, lastEnd + 2) !== "](") {
    return null;
  }
  return scanDestination(source, lastEnd + 2, end);
};

// alt text may hold nested link syntax, so brackets are balanced; an alt that defeats the walk fails verification downstream
const locateImageDestination = (source: string, span: Span): Span | null => {
  if (source.slice(span.start, span.start + 2) !== "![") {
    return null;
  }
  let i = span.start + 2;
  let depth = 1;
  while (i < span.end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") {
      depth += 1;
    } else if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    i += 1;
  }
  if (depth !== 0 || source.charAt(i + 1) !== "(") {
    return null;
  }
  return scanDestination(source, i + 2, span.end);
};

const locateDefinitionDestination = (source: string, span: Span): Span | null => {
  let i = span.start;
  if (source.charAt(i) !== "[") {
    return null;
  }
  i += 1;
  while (i < span.end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "]") {
      break;
    }
    i += 1;
  }
  if (source.charAt(i) !== "]" || source.charAt(i + 1) !== ":") {
    return null;
  }
  return scanDestination(source, i + 2, span.end);
};

const splitRawFragment = (source: string, dest: Span): Span => {
  let i = dest.start;
  while (i < dest.end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "#") {
      return { end: i, start: dest.start };
    }
    i += 1;
  }
  return dest;
};

const wikiToLink = (
  source: string,
  embed: boolean,
  body: string,
  pos: NodePosition | null,
  verbatim: readonly VerbatimSpan[],
): ExtractedLink | null => {
  if (!pos) {
    return null;
  }
  const parsed = parseWikiBodyRange(body);
  // `[[#sec]]` is a same-file reference, not a note link
  if (parsed.target === "" || parsed.targetRange === undefined) {
    return null;
  }
  const bodyStart = pos.span.start + (embed ? 3 : 2);
  const targetSpan: Span = {
    end: bodyStart + parsed.targetRange.end,
    start: bodyStart + parsed.targetRange.start,
  };
  const verified =
    source.slice(pos.span.start, pos.span.end) === `${embed ? "!" : ""}[[${body}]]` &&
    source.slice(targetSpan.start, targetSpan.end) === parsed.target &&
    !insideVerbatim(verbatim, targetSpan.start, targetSpan.end);
  const link: ExtractedLink = {
    embed,
    kind: "wiki",
    line: pos.line,
    target: parsed.target,
  };
  if (parsed.anchor !== undefined) {
    link.anchor = parsed.anchor;
  }
  if (parsed.alias !== undefined) {
    link.alias = parsed.alias;
  }
  if (verified) {
    link.targetSpan = targetSpan;
  }
  return link;
};

// assets extract too (`![](img.png)` must survive a rename); note-only queries filter on the resolved target
const mdToLink = (
  source: string,
  kind: "md" | "image",
  url: string,
  label: string,
  pos: NodePosition,
  dest: Span | null,
  verbatim: readonly VerbatimSpan[],
): ExtractedLink | null => {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || SCHEME.test(url)) {
    return null;
  }
  const hash = url.indexOf("#");
  const urlPath = hash === -1 ? url : url.slice(0, hash);
  const anchor = hash === -1 ? "" : url.slice(hash + 1);
  if (urlPath === "") {
    return null;
  }
  const target = safeDecode(urlPath);
  let targetSpan: Span | undefined;
  if (dest) {
    const pathSpan = splitRawFragment(source, dest);
    if (
      decodeMdEscapes(source.slice(pathSpan.start, pathSpan.end)) === urlPath &&
      !insideVerbatim(verbatim, pathSpan.start, pathSpan.end)
    ) {
      targetSpan = pathSpan;
    }
  }
  const link: ExtractedLink = {
    embed: kind === "image",
    kind,
    line: pos.line,
    target,
  };
  if (anchor !== "") {
    link.anchor = anchor;
  }
  if (label !== "") {
    link.alias = label;
  }
  if (targetSpan) {
    link.targetSpan = targetSpan;
  }
  return link;
};

const parseFrontmatter = (tree: Nodes): ParsedProperties | null => {
  if (!("children" in tree)) {
    return null;
  }
  const yaml = tree.children.find((child) => child.type === "yaml");
  if (!yaml || yaml.type !== "yaml") {
    return null;
  }
  return parseProperties(yaml.value);
};

const frontmatterTags = (parsed: ParsedProperties | null): string[] => {
  if (parsed === null || parsed.kind !== "valid") {
    return [];
  }
  const prop = parsed.properties.find((p) => p.key === "tags" && p.type === "tags");
  if (!prop || prop.type !== "tags") {
    return [];
  }
  return prop.value.map((tag) => tag.replace(/^#/u, "").trim()).filter((tag) => tag !== "");
};

// obsidian interop: a single-string scalar and the legacy `alias:` key are accepted too
const frontmatterAliases = (parsed: ParsedProperties | null): string[] => {
  if (parsed === null || parsed.kind !== "valid") {
    return [];
  }
  const prop =
    parsed.properties.find((p) => p.key === "aliases") ??
    parsed.properties.find((p) => p.key === "alias");
  if (!prop) {
    return [];
  }
  let values: readonly string[] = [];
  if (prop.type === "tags") {
    values = prop.value;
  } else if (prop.type === "text" || prop.type === "date") {
    // a date-shaped alias like `2026-07-01` classifies as date but is still a string
    values = [prop.value];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const alias = raw.trim();
    if (alias === "") {
      continue;
    }
    const key = alias.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(alias);
  }
  return out;
};

const frontmatterTasksDisabled = (parsed: ParsedProperties | null): boolean => {
  if (parsed === null || parsed.kind !== "valid") {
    return false;
  }
  const prop = parsed.properties.find((p) => p.key === "tasks");
  return prop !== undefined && prop.type === "checkbox" && !prop.value;
};

const frontmatterPinned = (parsed: ParsedProperties | null): boolean => {
  if (parsed === null || parsed.kind !== "valid") {
    return false;
  }
  const prop = parsed.properties.find((p) => p.key === PINNED_KEY);
  return prop !== undefined && prop.type === "checkbox" && prop.value;
};

// link/image subtrees are suppressed so a `[label #not-a-tag](url)` label is not a tag
const collectInlineTags = (node: Nodes, out: string[], suppressed: boolean): void => {
  if (node.type === "text") {
    if (suppressed) {
      return;
    }
    for (const { tag } of inlineTagSpans(node.value)) {
      out.push(tag);
    }
    return;
  }
  const nextSuppressed =
    suppressed ||
    node.type === "link" ||
    node.type === "linkReference" ||
    node.type === "image" ||
    node.type === "imageReference";
  if ("children" in node) {
    for (const child of node.children) {
      collectInlineTags(child, out, nextSuppressed);
    }
  }
};

const extractTags = (tree: Nodes, frontmatter: ParsedProperties | null): string[] => {
  const tags = [...frontmatterTags(frontmatter)];
  collectInlineTags(tree, tags, false);
  return tags;
};

// the spans a rename may splice: the index's own walk, each span verified against the raw
// bytes (a text node's value can differ from its source through an escape) and held outside
// the verbatim ranges, on the link policy's terms.
export const documentTagSpans = (source: string): InlineTagSpan[] => {
  const tree = parseScan(source);
  const verbatim = verbatimSpans(source);
  const spans: InlineTagSpan[] = [];
  const visit = (node: Nodes, suppressed: boolean): void => {
    if (node.type === "text") {
      if (suppressed) {
        return;
      }
      const pos = position(node);
      if (pos === null) {
        return;
      }
      for (const span of inlineTagSpans(node.value)) {
        const start = pos.span.start + span.start;
        const end = pos.span.start + span.end;
        if (source.slice(start, end) !== `#${span.tag}`) {
          continue;
        }
        if (insideVerbatim(verbatim, start, end)) {
          continue;
        }
        spans.push({ end, start, tag: span.tag });
      }
      return;
    }
    const nextSuppressed =
      suppressed ||
      node.type === "link" ||
      node.type === "linkReference" ||
      node.type === "image" ||
      node.type === "imageReference";
    if ("children" in node) {
      for (const child of node.children) {
        visit(child, nextSuppressed);
      }
    }
  };
  visit(tree, false);
  return spans;
};

const collectHeading = (node: Extract<Nodes, { type: "heading" }>, scan: DocScan): void => {
  const text = textOf(node);
  scan.headings.push(text);
  if (node.depth === 1 && scan.title === null && text !== "") {
    scan.title = text;
  }
};

const collectWikiLink = (
  node: Extract<Nodes, { type: "wikiLink" | "wikiEmbed" }>,
  ctx: ScanContext,
): void => {
  const link = wikiToLink(
    ctx.source,
    node.type === "wikiEmbed",
    node.body,
    position(node),
    ctx.verbatim,
  );
  if (link) {
    ctx.scan.links.push(link);
  }
};

const collectMdLink = (node: Extract<Nodes, { type: "link" }>, ctx: ScanContext): void => {
  const pos = position(node);
  if (!pos) {
    return;
  }
  const last = node.children.at(-1);
  const lastEnd = last ? position(last)?.span.end : pos.span.start + 1;
  const dest = lastEnd === undefined ? null : locateDestination(ctx.source, lastEnd, pos.span.end);
  const link = mdToLink(ctx.source, "md", node.url, textOf(node), pos, dest, ctx.verbatim);
  if (link) {
    ctx.scan.links.push(link);
  }
};

const collectImage = (node: Extract<Nodes, { type: "image" }>, ctx: ScanContext): void => {
  const pos = position(node);
  if (!pos) {
    return;
  }
  const dest = locateImageDestination(ctx.source, pos.span);
  const link = mdToLink(ctx.source, "image", node.url, node.alt ?? "", pos, dest, ctx.verbatim);
  if (link) {
    ctx.scan.links.push(link);
  }
};

const collectDefinition = (
  node: Extract<Nodes, { type: "definition" }>,
  ctx: ScanContext,
): void => {
  const pos = position(node);
  if (!pos) {
    return;
  }
  const dest = locateDefinitionDestination(ctx.source, pos.span);
  const link = mdToLink(ctx.source, "md", node.url, node.label ?? "", pos, dest, ctx.verbatim);
  if (link) {
    ctx.scan.links.push(link);
  }
};

// A callout body is markdown the editor renders, so its links are indexed with
// spans shifted into the outer source. Only a column-0 fence qualifies: an
// indented fence prefixes every body line, so a flat offset shift names wrong bytes.
const calloutBodySlice = (
  source: string,
  node: Extract<Nodes, { type: "code" }>,
): { body: string; bodyStart: number } | null => {
  const pos = node.position;
  if (pos?.start.offset === undefined || pos.start.column !== 1) {
    return null;
  }
  const openLineEnd = source.indexOf("\n", pos.start.offset);
  if (openLineEnd === -1) {
    return null;
  }
  // an unknown kind renders as a plain code block, where a wiki spelling is not a link
  const payload = parseCalloutPayload(node.value);
  if (payload === null) {
    return null;
  }
  const lines = node.value.split("\n");
  const { headerLines } = payload;
  let bodyStart = openLineEnd + 1;
  for (let skipped = 0; skipped < headerLines; skipped += 1) {
    const nl = source.indexOf("\n", bodyStart);
    if (nl === -1) {
      return null;
    }
    bodyStart = nl + 1;
  }
  const body = lines.slice(headerLines).join("\n");
  if (source.slice(bodyStart, bodyStart + body.length) !== body) {
    return null;
  }
  return { body, bodyStart };
};

const pushShiftedLinks = (
  links: readonly ExtractedLink[],
  bodyStart: number,
  ctx: ScanContext,
): void => {
  const lineShift = ctx.source.slice(0, bodyStart).split("\n").length - 1;
  for (const link of links) {
    const shifted: ExtractedLink = { ...link, line: link.line + lineShift };
    if (link.targetSpan !== undefined) {
      shifted.targetSpan = {
        end: link.targetSpan.end + bodyStart,
        start: link.targetSpan.start + bodyStart,
      };
    }
    ctx.scan.links.push(shifted);
  }
};

export const scanDoc = (source: string): DocScan => {
  const tree = parseScan(source);
  const frontmatter = parseFrontmatter(tree);
  const verbatim = verbatimSpans(source);
  const scan: DocScan = {
    aliases: frontmatterAliases(frontmatter),
    headings: [],
    links: [],
    noteId: noteIdOf(frontmatter),
    pinned: frontmatterPinned(frontmatter),
    tags: extractTags(tree, frontmatter),
    tasks: frontmatterTasksDisabled(frontmatter) ? [] : tasksInTree(tree, source),
    title: null,
  };
  const ctx: ScanContext = { scan, source, verbatim };
  // oxlint-disable-next-line complexity -- the count is the node-type enumeration switch-exhaustiveness-check requires, not branching: every arm delegates
  walk(tree, (node) => {
    switch (node.type) {
      case "heading": {
        collectHeading(node, scan);
        break;
      }
      case "wikiLink":
      case "wikiEmbed": {
        collectWikiLink(node, ctx);
        break;
      }
      case "link": {
        collectMdLink(node, ctx);
        break;
      }
      case "image": {
        collectImage(node, ctx);
        break;
      }
      case "definition": {
        collectDefinition(node, ctx);
        break;
      }
      case "code": {
        const slice = isCalloutLang(node.lang) ? calloutBodySlice(source, node) : null;
        if (slice) {
          pushShiftedLinks(scanDoc(slice.body).links, slice.bodyStart, ctx);
        }
        break;
      }
      case "blockquote":
      case "break":
      case "commentMarker":
      case "delete":
      case "emphasis":
      case "footnoteDefinition":
      case "footnoteReference":
      case "formulaPill":
      case "html":
      case "imageReference":
      case "inlineCode":
      case "inlineMath":
      case "linkReference":
      case "list":
      case "listItem":
      case "math":
      case "mdxFlowExpression":
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement":
      case "mdxTextExpression":
      case "mdxjsEsm":
      case "opaqueBlock":
      case "opaqueInline":
      case "paragraph":
      case "root":
      case "strong":
      case "tabGroup":
      case "tabPanel":
      case "table":
      case "tableCell":
      case "tableRow":
      case "text":
      case "thematicBreak":
      case "yaml": {
        break;
      }
      // no default
    }
  });
  return scan;
};
