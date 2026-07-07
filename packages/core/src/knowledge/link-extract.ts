// ---------------------------------------------------------------------------
// Doc scanning for the knowledge index: one remark parse per doc yields the
// title, the headings, and every vault-local link — wiki links/embeds,
// standard relative md links (note AND asset targets), and md images — with
// exact source spans. Parsing reuses the SAME remark-wiki-link tokenizer the
// editor pipeline runs, so extraction agrees with what the editor renders —
// and fence/code-span safety is inherited from the parser (text constructs
// never run inside code), not re-implemented with regexes.
//
// Pipeline note: math and the MDX-agnostic vocabulary plugins are omitted —
// they only re-shape nodes whose TEXT content still parses here (links inside
// `<toggle>` bodies etc. are separated from the tag by blank lines in the
// canonical form). Links inside raw block-level HTML runs are not extracted.
//
// Span contract: `targetSpan` is emitted only after the bytes are verified
// (the raw slice re-derives the parsed target). A link that fails verification
// is still indexed (backlinks/graph) but is never rewritten.
// ---------------------------------------------------------------------------

import type { Nodes } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { parseWikiBodyRange, remarkWikiLink } from "../markdown/remark-wiki-link";
import { basenamePath, extnamePath } from "./vault-path";

export type Span = { start: number; end: number };
/** `wiki` = `[[..]]` / `![[..]]`, `md` = `[..](..)` + reference definitions,
 * `image` = `![..](..)` standard md images. */
export type LinkKind = "wiki" | "md" | "image";

export type ExtractedLink = {
  kind: LinkKind;
  /** Rendered-inline reference: `![[embed]]` transclusions and md images.
   * Always false for plain wiki/md links. */
  embed: boolean;
  /** Resolution input: the target as written (percent-decoded for md links),
   * anchor/alias stripped. Never empty. */
  target: string;
  /** Heading anchor after `#`, when present. */
  anchor?: string;
  /** Display text: the wiki `|alias`, an md link's label, or an image's alt. */
  alias?: string;
  /** 1-based source line the link starts on. */
  line: number;
  /** Code-unit span of the whole construct (`[[..]]`, `![[..]]`, `[..](..)`). */
  span: Span;
  /** Verified code-unit span of the rewritable target text (wiki target /
   * md path-part, excluding `<>` and `#fragment`). Absent when the raw bytes
   * could not be verified — such a link is indexed but never rewritten. */
  targetSpan?: Span;
};

export type DocScan = {
  /** First `#` heading's text, or null (callers fall back to the filename). */
  title: string | null;
  /** Every heading's text, any depth, in document order. */
  headings: string[];
  links: ExtractedLink[];
};

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkWikiLink);

/** Parse a doc once and pull out title, headings, and note links. */
export function scanDoc(source: string): DocScan {
  const tree = processor.parse(source);
  const scan: DocScan = { title: null, headings: [], links: [] };
  walk(tree, (node) => {
    switch (node.type) {
      case "heading": {
        const text = textOf(node);
        scan.headings.push(text);
        if (node.depth === 1 && scan.title === null && text !== "") scan.title = text;
        return;
      }
      case "wikiLink":
      case "wikiEmbed": {
        const link = wikiToLink(source, node.type === "wikiEmbed", node.body, position(node));
        if (link) scan.links.push(link);
        return;
      }
      case "link": {
        const pos = position(node);
        if (!pos) return;
        const last = node.children.at(-1);
        const lastEnd = last ? position(last)?.span.end : pos.span.start + 1;
        const dest =
          lastEnd === undefined ? null : locateDestination(source, lastEnd, pos.span.end);
        const link = mdToLink(source, "md", node.url, textOf(node), pos, dest);
        if (link) scan.links.push(link);
        return;
      }
      case "image": {
        const pos = position(node);
        if (!pos) return;
        const dest = locateImageDestination(source, pos.span);
        const link = mdToLink(source, "image", node.url, node.alt ?? "", pos, dest);
        if (link) scan.links.push(link);
        return;
      }
      case "definition": {
        const pos = position(node);
        if (!pos) return;
        const dest = locateDefinitionDestination(source, pos.span);
        const link = mdToLink(source, "md", node.url, node.label ?? "", pos, dest);
        if (link) scan.links.push(link);
        return;
      }
      default:
    }
  });
  return scan;
}

// ---- Tree walking -----------------------------------------------------------

function walk(node: Nodes, visitor: (node: Nodes) => void): void {
  visitor(node);
  if ("children" in node) {
    for (const child of node.children) walk(child, visitor);
  }
}

/** Concatenated text content of a node's subtree (labels, heading text). */
function textOf(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if ("children" in node) return node.children.map(textOf).join("");
  return "";
}

type NodePosition = { span: Span; line: number };

function position(node: Nodes): NodePosition | null {
  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) return null;
  return { span: { start: start.offset, end: end.offset }, line: start.line };
}

// ---- Wiki links -------------------------------------------------------------

function wikiToLink(
  source: string,
  embed: boolean,
  body: string,
  pos: NodePosition | null,
): ExtractedLink | null {
  if (!pos) return null;
  const parsed = parseWikiBodyRange(body);
  // Pure-anchor (`[[#sec]]`) and degenerate empty targets are same-file
  // references — no note link to index.
  if (parsed.target === "" || parsed.targetRange === undefined) return null;
  const bodyStart = pos.span.start + (embed ? 3 : 2);
  const targetSpan: Span = {
    start: bodyStart + parsed.targetRange.start,
    end: bodyStart + parsed.targetRange.end,
  };
  // Byte verification: the recorded span must re-derive the parsed target.
  const verified =
    source.slice(pos.span.start, pos.span.end) === `${embed ? "!" : ""}[[${body}]]` &&
    source.slice(targetSpan.start, targetSpan.end) === parsed.target;
  const link: ExtractedLink = {
    kind: "wiki",
    embed,
    target: parsed.target,
    line: pos.line,
    span: pos.span,
  };
  if (parsed.anchor !== undefined) link.anchor = parsed.anchor;
  if (parsed.alias !== undefined) link.alias = parsed.alias;
  if (verified) link.targetSpan = targetSpan;
  return link;
}

// ---- Standard markdown links and images ---------------------------------------

// Everything with a scheme (`https:`, `mailto:`, `C:\…`) or protocol-relative
// `//` is external; pure-fragment urls are same-file references.
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// Every LOCAL url extracts, note or asset alike — `![](img.png)` and
// `[pdf](paper.pdf)` must survive a rename of their target exactly like
// `[[note]]` does. Queries that only want notes (the graph) filter on the
// RESOLVED target, not at extraction.
function mdToLink(
  source: string,
  kind: "md" | "image",
  url: string,
  label: string,
  pos: NodePosition,
  dest: Span | null,
): ExtractedLink | null {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || SCHEME.test(url)) return null;
  const hash = url.indexOf("#");
  const urlPath = hash === -1 ? url : url.slice(0, hash);
  const anchor = hash === -1 ? "" : url.slice(hash + 1);
  if (urlPath === "") return null;
  const target = safeDecode(urlPath);
  // Verify the located destination bytes re-derive the parsed url path; only
  // then is the span trusted for rewriting.
  let targetSpan: Span | undefined;
  if (dest) {
    const pathSpan = splitRawFragment(source, dest);
    if (decodeMdEscapes(source.slice(pathSpan.start, pathSpan.end)) === urlPath) {
      targetSpan = pathSpan;
    }
  }
  const link: ExtractedLink = {
    kind,
    embed: kind === "image",
    target,
    line: pos.line,
    span: pos.span,
  };
  if (anchor !== "") link.anchor = anchor;
  if (label !== "") link.alias = label;
  if (targetSpan) link.targetSpan = targetSpan;
  return link;
}

function safeDecode(urlPath: string): string {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return urlPath;
  }
}

/** Undo micromark's backslash escapes (ASCII punctuation only) — how a raw
 * destination slice maps to the mdast `url` value. Character references stay
 * un-decoded: a destination using them simply fails verification and is left
 * un-rewritable, which is the safe side. */
function decodeMdEscapes(raw: string): string {
  return raw.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/** Scan a link/definition destination starting at `from` (just past `](` or
 * `]:`): optional whitespace, then `<dest>` or a bare destination with
 * balanced parens. Returns the span EXCLUDING any `<>` wrapper. */
function scanDestination(source: string, from: number, end: number): Span | null {
  let i = from;
  while (i < end && isSpace(source.charAt(i))) i++;
  if (i >= end) return null;
  if (source.charAt(i) === "<") {
    const close = source.indexOf(">", i + 1);
    if (close === -1 || close > end) return null;
    return { start: i + 1, end: close };
  }
  const start = i;
  let depth = 0;
  while (i < end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (isSpace(c)) break;
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  if (i > end || i <= start) return null;
  return { start, end: i };
}

/** For a resource link: `lastEnd` is where the label's content stops; expect
 * the `](`, then scan the destination. */
function locateDestination(source: string, lastEnd: number, end: number): Span | null {
  if (source.slice(lastEnd, lastEnd + 2) !== "](") return null;
  return scanDestination(source, lastEnd + 2, end);
}

/** For an image: skip `![`, walk the description with balanced brackets
 * (image alt may contain nested link syntax), expect `](`, then scan. An alt
 * whose brackets defeat the walk (e.g. a code span holding a stray `]`) just
 * fails byte verification downstream — indexed, never rewritten. */
function locateImageDestination(source: string, span: Span): Span | null {
  if (source.slice(span.start, span.start + 2) !== "![") return null;
  let i = span.start + 2;
  let depth = 1;
  while (i < span.end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  if (depth !== 0 || source.charAt(i + 1) !== "(") return null;
  return scanDestination(source, i + 2, span.end);
}

/** For a definition: skip the `[label]`, expect `:`, then scan. */
function locateDefinitionDestination(source: string, span: Span): Span | null {
  let i = span.start;
  if (source.charAt(i) !== "[") return null;
  i++;
  while (i < span.end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "]") break;
    i++;
  }
  if (source.charAt(i) !== "]" || source.charAt(i + 1) !== ":") return null;
  return scanDestination(source, i + 2, span.end);
}

/** Split a raw destination span at its first unescaped `#` (fragment). */
function splitRawFragment(source: string, dest: Span): Span {
  let i = dest.start;
  while (i < dest.end) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "#") return { start: dest.start, end: i };
    i++;
  }
  return dest;
}

/** Human title for a path when the doc has no `#` heading. */
export function titleFromPath(path: string): string {
  const base = basenamePath(path);
  const ext = extnamePath(base);
  return ext === "" ? base : base.slice(0, -ext.length);
}
