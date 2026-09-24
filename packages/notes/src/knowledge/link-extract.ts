// The scan grammar (../markdown/scan-parse) is plain markdown and the editor's
// is not, so a `targetSpan` or a tag's span is emitted only where the raw bytes
// re-derive what was parsed and lie outside ../markdown/verbatim-spans; a link or
// a tag failing either is indexed but never rewritten.

import type { Nodes } from "mdast";

import { parseCalloutPayload } from "../markdown/callout-payload";
import { isCalloutLang } from "../markdown/fence-langs";
import {
  noteIdOfProperties,
  parseProperties,
  PINNED_KEY,
  TAGS_KEY,
  yamlStringEntries,
} from "../markdown/frontmatter";
import type { ParsedProperties, YamlStringEntry } from "../markdown/frontmatter";
import { parseWikiBodyRange } from "../markdown/remark-wiki-link";
import { parseScan } from "../markdown/scan-parse";
import { insideVerbatim, verbatimSpans } from "../markdown/verbatim-spans";
import type { VerbatimSpan } from "../markdown/verbatim-spans";
import type { LinkKind } from "./link-kinds";
import { inlineTagSpans, isTagName } from "./tag-grammar";
import type { InlineTagSpan } from "./tag-grammar";
import { tasksInTree } from "./task-ordinal";
import type { ExtractedTask } from "./task-ordinal";

export interface Span {
  start: number;
  end: number;
}

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

// an inline tag, and its span when a rename may splice it
interface ExtractedTag {
  tag: string;
  span?: Span;
}

// what a body holds; a callout's body is scanned as one and folded into the body around it
interface BodyScan {
  title: string | null;
  headings: string[];
  links: ExtractedLink[];
  tags: ExtractedTag[];
}

interface NodePosition {
  span: Span;
  line: number;
}

// the source, the ranges a span may not land in, and the scan every collector appends to
interface ScanContext {
  source: string;
  verbatim: readonly VerbatimSpan[];
  scan: BodyScan;
}

// anything with a scheme (`https:`, `mailto:`, `C:\…` alike) or protocol-relative `//` is external
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

// a label is text inside one of these, and `[label #not-a-tag](url)` holds no tag
const LINK_LIKE = new Set<Nodes["type"]>(["image", "imageReference", "link", "linkReference"]);

const position = (node: Nodes): NodePosition | null => {
  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) {
    return null;
  }
  return { line: start.line, span: { end: end.offset, start: start.offset } };
};

const walk = (
  node: Nodes,
  visitor: (node: Nodes, inLink: boolean) => void,
  inLink = false,
): void => {
  visitor(node, inLink);
  if ("children" in node) {
    const childrenInLink = inLink || LINK_LIKE.has(node.type);
    for (const child of node.children) {
      walk(child, visitor, childrenInLink);
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

interface MdUrl {
  /** the path as written, before any `#` */
  written: string;
  target: string;
  anchor: string;
}

const parseMdUrl = (url: string): MdUrl | null => {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || SCHEME.test(url)) {
    return null;
  }
  const hash = url.indexOf("#");
  const written = hash === -1 ? url : url.slice(0, hash);
  const anchor = hash === -1 ? "" : url.slice(hash + 1);
  return { anchor, target: safeDecode(written), written };
};

// the target the scan indexes an md url under, so the editor locates and resolves the link
// the index reports; null for an external or same-note url
export const mdLinkTarget = (url: string): string | null => parseMdUrl(url)?.target ?? null;

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
  // the span may hold `\#` escapes the target does not: a rename writes its target back through
  // serializeWikiBody, which escapes what the parse would otherwise split
  const verified =
    source.slice(pos.span.start, pos.span.end) === `${embed ? "!" : ""}[[${body}]]` &&
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
  const parsed = parseMdUrl(url);
  if (parsed === null) {
    return null;
  }
  const { anchor, target, written } = parsed;
  let targetSpan: Span | undefined;
  if (dest) {
    const pathSpan = splitRawFragment(source, dest);
    if (
      decodeMdEscapes(source.slice(pathSpan.start, pathSpan.end)) === written &&
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

const frontmatterText = (tree: Nodes): string | null => {
  if (!("children" in tree)) {
    return null;
  }
  const yaml = tree.children.find((child) => child.type === "yaml");
  return yaml?.type === "yaml" ? yaml.value : null;
};

interface FrontmatterTag {
  tag: string;
  // written `#tag`, which a rename keeps
  hashed: boolean;
  entry: YamlStringEntry;
}

// The index reads these and a rename splices them, so the two cannot disagree. A list or one bare
// string, as Obsidian accepts; a value outside the tag grammar (`reading list`, a quoted `2026`)
// is no tag, since no inline `#` could address it.
export const frontmatterTags = (yaml: string): FrontmatterTag[] =>
  yamlStringEntries(yaml, TAGS_KEY).flatMap((entry) => {
    const hashed = entry.value.startsWith("#");
    const tag = (hashed ? entry.value.slice(1) : entry.value).trim();
    return isTagName(tag) ? [{ entry, hashed, tag }] : [];
  });

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

// a span is kept where the raw bytes spell the tag (a text node's value can differ from its
// source through an escape) outside the verbatim ranges, on the link policy's terms
const collectTextTags = (node: Extract<Nodes, { type: "text" }>, ctx: ScanContext): void => {
  const offset = node.position?.start.offset;
  for (const { end, start, tag } of inlineTagSpans(node.value)) {
    const extracted: ExtractedTag = { tag };
    if (offset !== undefined) {
      const span: Span = { end: offset + end, start: offset + start };
      if (
        ctx.source.slice(span.start, span.end) === `#${tag}` &&
        !insideVerbatim(ctx.verbatim, span.start, span.end)
      ) {
        extracted.span = span;
      }
    }
    ctx.scan.tags.push(extracted);
  }
};

const collectHeading = (node: Extract<Nodes, { type: "heading" }>, scan: BodyScan): void => {
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

// A callout body is markdown the editor renders, so its links and tags are indexed
// with spans shifted into the outer source. Only a column-0 fence qualifies: an
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

// a callout's links and tags, moved to where its body sits in the outer source
const pushShifted = (body: BodyScan, bodyStart: number, ctx: ScanContext): void => {
  const lineShift = ctx.source.slice(0, bodyStart).split("\n").length - 1;
  const shift = (span: Span): Span => ({
    end: span.end + bodyStart,
    start: span.start + bodyStart,
  });
  for (const link of body.links) {
    const shifted: ExtractedLink = { ...link, line: link.line + lineShift };
    if (link.targetSpan !== undefined) {
      shifted.targetSpan = shift(link.targetSpan);
    }
    ctx.scan.links.push(shifted);
  }
  for (const { span, tag } of body.tags) {
    ctx.scan.tags.push(span === undefined ? { tag } : { span: shift(span), tag });
  }
};

const scanBody = (source: string, tree: Nodes): BodyScan => {
  const scan: BodyScan = { headings: [], links: [], tags: [], title: null };
  const ctx: ScanContext = { scan, source, verbatim: verbatimSpans(source) };
  // oxlint-disable-next-line complexity -- the count is the node-type enumeration switch-exhaustiveness-check requires, not branching: every arm delegates
  walk(tree, (node, inLink) => {
    switch (node.type) {
      case "text": {
        if (!inLink) {
          collectTextTags(node, ctx);
        }
        break;
      }
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
          pushShifted(scanBody(slice.body, parseScan(slice.body)), slice.bodyStart, ctx);
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
      case "thematicBreak":
      case "yaml": {
        break;
      }
      // no default
    }
  });
  return scan;
};

export const scanDoc = (source: string): DocScan => {
  const tree = parseScan(source);
  const yaml = frontmatterText(tree);
  const frontmatter = yaml === null ? null : parseProperties(yaml);
  const body = scanBody(source, tree);
  return {
    aliases: frontmatterAliases(frontmatter),
    headings: body.headings,
    links: body.links,
    noteId: noteIdOfProperties(frontmatter),
    pinned: frontmatterPinned(frontmatter),
    tags: [
      ...(yaml === null ? [] : frontmatterTags(yaml).map(({ tag }) => tag)),
      ...body.tags.map(({ tag }) => tag),
    ],
    tasks: frontmatterTasksDisabled(frontmatter) ? [] : tasksInTree(tree, source),
    title: body.title,
  };
};

// the spans a rename may splice: the index's own walk, callout bodies included
export const documentTagSpans = (source: string): InlineTagSpan[] =>
  scanBody(source, parseScan(source)).tags.flatMap(({ span, tag }) =>
    span === undefined ? [] : [{ end: span.end, start: span.start, tag }],
  );
