// The scan walks the editor's own grammar (../markdown/bare-parse), so the index reads as prose
// exactly what the editor draws as prose. A `targetSpan` or a tag's span is emitted only where the
// raw bytes re-derive what was parsed and the editor does not hold them verbatim (inside a tag it
// cannot model, which it carries as a string); a link or a tag failing either is indexed but never
// rewritten. Only a rename asks for spans; the index, which projects every doc on every save,
// never verifies them.

import type { Nodes } from "mdast";

import { parseBare } from "../markdown/bare-parse";
import {
  noteIdOfProperties,
  parseProperties,
  PINNED_KEY,
  TAGS_KEY,
  yamlStringEntries,
} from "../markdown/frontmatter";
import type { ParsedProperties, YamlStringEntry } from "../markdown/frontmatter";
import { isOpaqueSource } from "../markdown/remark-opaque";
import type { PlateDeclaredType } from "../markdown/remark-opaque";
import { parseWikiBodyRange } from "../markdown/remark-wiki-link";
import type { LinkKind } from "./link-kinds";
import { inlineTagSpans, isTagName } from "./tag-grammar";
import type { InlineTagSpan } from "./tag-grammar";

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
}

// a link whose target bytes a rename may splice
export interface RewritableLink extends ExtractedLink {
  targetSpan: Span;
}

export interface DocScan {
  title: string | null;
  headings: string[];
  links: ExtractedLink[];
  tags: string[];
  aliases: string[];
  pinned: boolean;
  noteId: string | null;
}

type ScannedLink = ExtractedLink & { targetSpan?: Span };

interface ExtractedTag {
  tag: string;
  span?: Span;
}

interface BodyScan {
  title: string | null;
  headings: string[];
  links: ScannedLink[];
  tags: ExtractedTag[];
}

interface NodePosition {
  span: Span;
  line: number;
}

// the source, whether a span may be emitted here (never on the index path, never inside bytes the
// editor holds verbatim), and the scan every collector appends to
interface ScanContext {
  source: string;
  spans: boolean;
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

interface Visit {
  inLink: boolean;
  // inside a node the editor carries as its source string
  verbatim: boolean;
}

const AT_ROOT: Visit = { inLink: false, verbatim: false };

const walk = (node: Nodes, visitor: (node: Nodes, at: Visit) => void, at = AT_ROOT): void => {
  const here: Visit = { inLink: at.inLink, verbatim: at.verbatim || isOpaqueSource(node) };
  visitor(node, here);
  if ("children" in node) {
    const below: Visit = {
      inLink: here.inLink || LINK_LIKE.has(node.type),
      verbatim: here.verbatim,
    };
    for (const child of node.children) {
      walk(child, visitor, below);
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
  ctx: ScanContext,
  embed: boolean,
  body: string,
  pos: NodePosition | null,
): ScannedLink | null => {
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
    ctx.spans &&
    ctx.source.slice(pos.span.start, pos.span.end) === `${embed ? "!" : ""}[[${body}]]`;
  const link: ScannedLink = {
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
  ctx: ScanContext,
  kind: "md" | "image",
  url: string,
  label: string,
  pos: NodePosition,
  locate: () => Span | null,
): ScannedLink | null => {
  const parsed = parseMdUrl(url);
  if (parsed === null) {
    return null;
  }
  const { anchor, target, written } = parsed;
  let targetSpan: Span | undefined;
  const dest = ctx.spans ? locate() : null;
  if (dest) {
    const pathSpan = splitRawFragment(ctx.source, dest);
    if (decodeMdEscapes(ctx.source.slice(pathSpan.start, pathSpan.end)) === written) {
      targetSpan = pathSpan;
    }
  }
  const link: ScannedLink = {
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
export const frontmatterAliases = (parsed: ParsedProperties | null): string[] => {
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

const frontmatterPinned = (parsed: ParsedProperties | null): boolean => {
  if (parsed === null || parsed.kind !== "valid") {
    return false;
  }
  const prop = parsed.properties.find((p) => p.key === PINNED_KEY);
  return prop !== undefined && prop.type === "checkbox" && prop.value;
};

interface ValueLine {
  valueStart: number;
  // null where the line's bytes do not re-derive it
  sourceStart: number | null;
}

// a text node's later lines sit past their container's prefix (an alert's `> `, a list item's
// indent), which its value drops, so each is found where its own bytes start in that source line
const valueLines = (value: string, offset: number, source: string): ValueLine[] => {
  const [first = "", ...rest] = value.split("\n");
  const lines: ValueLine[] = [{ sourceStart: offset, valueStart: 0 }];
  let valueStart = first.length + 1;
  let lineEnd = source.indexOf("\n", offset);
  for (const line of rest) {
    const lineStart = lineEnd === -1 ? -1 : lineEnd + 1;
    lineEnd = lineStart === -1 ? -1 : source.indexOf("\n", lineStart);
    const at = lineStart === -1 ? -1 : source.indexOf(line, lineStart);
    const inLine = at !== -1 && (lineEnd === -1 || at + line.length <= lineEnd);
    lines.push({ sourceStart: inLine ? at : null, valueStart });
    valueStart += line.length + 1;
  }
  return lines;
};

// a span is kept where the raw bytes spell the tag (a text node's value can differ from its
// source through an escape), on the link policy's terms
const collectTextTags = (node: Extract<Nodes, { type: "text" }>, ctx: ScanContext): void => {
  const offset = node.position?.start.offset;
  const tags = inlineTagSpans(node.value);
  const lines =
    offset === undefined || !ctx.spans || tags.length === 0
      ? []
      : valueLines(node.value, offset, ctx.source);
  for (const { end, start, tag } of tags) {
    const extracted: ExtractedTag = { tag };
    const line = lines.findLast(({ valueStart }) => valueStart <= start);
    if (line !== undefined && line.sourceStart !== null) {
      const shift = line.sourceStart - line.valueStart;
      const span: Span = { end: end + shift, start: start + shift };
      if (ctx.source.slice(span.start, span.end) === `#${tag}`) {
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
  const link = wikiToLink(ctx, node.type === "wikiEmbed", node.body, position(node));
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
  const link = mdToLink(ctx, "md", node.url, textOf(node), pos, () =>
    lastEnd === undefined ? null : locateDestination(ctx.source, lastEnd, pos.span.end),
  );
  if (link) {
    ctx.scan.links.push(link);
  }
};

const collectImage = (node: Extract<Nodes, { type: "image" }>, ctx: ScanContext): void => {
  const pos = position(node);
  if (!pos) {
    return;
  }
  const link = mdToLink(ctx, "image", node.url, node.alt ?? "", pos, () =>
    locateImageDestination(ctx.source, pos.span),
  );
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
  const link = mdToLink(ctx, "md", node.url, node.label ?? "", pos, () =>
    locateDefinitionDestination(ctx.source, pos.span),
  );
  if (link) {
    ctx.scan.links.push(link);
  }
};

// `index` reads what a doc holds; `rewrite` also verifies the spans a rename may splice
type ScanMode = "index" | "rewrite";

const scanBody = (source: string, tree: Nodes, mode: ScanMode): BodyScan => {
  const scan: BodyScan = { headings: [], links: [], tags: [], title: null };
  const doc: ScanContext = { scan, source, spans: mode === "rewrite" };
  const verbatim: ScanContext = { scan, source, spans: false };
  // oxlint-disable-next-line complexity -- the count is the node-type enumeration the default holds total, not branching: every arm delegates
  walk(tree, (node, at) => {
    const ctx = at.verbatim ? verbatim : doc;
    switch (node.type) {
      case "text": {
        if (!at.inLink) {
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
      case "blockquote":
      case "break":
      case "code":
      case "column":
      case "columnGroup":
      case "commentMarker":
      case "date":
      case "delete":
      case "emphasis":
      case "footnoteDefinition":
      case "footnoteReference":
      case "formulaPill":
      case "html":
      case "htmlElement":
      case "imageReference":
      case "inlineCode":
      case "inlineMath":
      case "linkReference":
      case "list":
      case "listItem":
      case "math":
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
      case "toggle":
      case "underline":
      case "yaml": {
        break;
      }
      default: {
        node satisfies Extract<Nodes, { type: PlateDeclaredType }>;
      }
    }
  });
  return scan;
};

export const scanDoc = (source: string): DocScan => {
  const tree = parseBare(source);
  const yaml = frontmatterText(tree);
  const frontmatter = yaml === null ? null : parseProperties(yaml);
  const body = scanBody(source, tree, "index");
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
    title: body.title,
  };
};

// the links a rename may splice: the index's own walk
export const documentLinkSpans = (source: string): RewritableLink[] =>
  scanBody(source, parseBare(source), "rewrite").links.flatMap((link) =>
    link.targetSpan === undefined ? [] : [{ ...link, targetSpan: link.targetSpan }],
  );

// the inline tags a rename may splice, on the same terms
export const documentTagSpans = (source: string): InlineTagSpan[] =>
  scanBody(source, parseBare(source), "rewrite").tags.flatMap(({ span, tag }) =>
    span === undefined ? [] : [{ end: span.end, start: span.start, tag }],
  );
