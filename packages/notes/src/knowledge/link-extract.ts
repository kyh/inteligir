// ---------------------------------------------------------------------------
// Doc scanning for the knowledge index: one remark parse per doc yields the
// title, the headings, and every vault-local link — wiki links/embeds,
// standard relative md links (note AND asset targets), and md images — with
// exact source spans. Parsing reuses the SAME remark-wiki-link tokenizer the
// editor pipeline runs, so extraction agrees with what the editor renders —
// and fence/code-span safety is inherited from the parser (text constructs
// never run inside code), not re-implemented with regexes.
//
// The grammar is ../markdown/scan-parse — shared with the task count, which
// depends on reading exactly the same one.
//
// Span contract: `targetSpan` is emitted only after the bytes are verified
// (the raw slice re-derives the parsed target). A link that fails verification
// is still indexed (backlinks/graph) but is never rewritten.
// ---------------------------------------------------------------------------

import type { Nodes } from "mdast";

import { parseProperties, type ParsedProperties } from "../markdown/frontmatter";
import { parseWikiBodyRange } from "../markdown/remark-wiki-link";
import { parseScan } from "../markdown/scan-parse";
import { tasksInTree, type ExtractedTask } from "./task-ordinal";
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
  /** The doc's tags, display case, deduped — frontmatter `tags` first (in
   * declaration order), then inline `#tag` tokens in document order. Unified
   * case-insensitively downstream by TagIndex. */
  tags: string[];
  /** Frontmatter `aliases` (Obsidian's alias list), display case, deduped
   * case-insensitively. The SINGLE extraction source for aliases — sibling
   * indexes consume this, never re-parse frontmatter. */
  aliases: string[];
  /** The doc's GFM task items, in ordinal order (./task-ordinal owns the
   * count). Empty when the note opts out via frontmatter `tasks: false`. */
  tasks: ExtractedTask[];
};

/** Parse a doc once and pull out title, headings, note links, tags, tasks. */
export function scanDoc(source: string): DocScan {
  const tree = parseScan(source);
  // ONE YAML parse per scan — every frontmatter extractor consumes this
  // result instead of re-locating the node and re-running parseProperties.
  const frontmatter = parseFrontmatter(tree);
  const scan: DocScan = {
    title: null,
    headings: [],
    links: [],
    tags: extractTags(tree, frontmatter),
    aliases: frontmatterAliases(frontmatter),
    tasks: frontmatterTasksDisabled(frontmatter) ? [] : tasksInTree(tree, source),
  };
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
      case "code": {
        if (node.lang === "moss-callout") scanCalloutBody(source, node, scan);
        return;
      }
      default:
    }
  });
  return scan;
}

/**
 * A moss-callout fence's body is MARKDOWN (the editor models and renders it,
 * wiki links included), so the scan must count what the editor draws —
 * editor ⊆ vault is the containment direction the knowledge index owes. The
 * body is re-scanned and every link's span is shifted into the OUTER source,
 * so rename byte-surgery lands inside the fence exactly.
 *
 * Only a column-0 fence qualifies: an indented fence (inside a list/quote)
 * prefixes every body line, and a flat offset shift would name wrong bytes —
 * those bodies are skipped whole, stated rather than mis-indexed.
 */
function scanCalloutBody(
  source: string,
  node: Extract<Nodes, { type: "code" }>,
  scan: DocScan,
): void {
  const pos = node.position;
  if (pos?.start.offset === undefined || pos.start.column !== 1) return;
  // Body bytes start after the opening-fence line and the kind/level header
  // lines; mdast's `value` is exactly the body, so locate it by line walking.
  const openLineEnd = source.indexOf("\n", pos.start.offset);
  if (openLineEnd === -1) return;
  const payloadStart = openLineEnd + 1;
  const lines = node.value.split("\n");
  const kind = lines[0]?.trim() ?? "";
  const level = lines[1]?.trim() ?? "";
  const headerLines =
    kind === "priority" && ["low", "medium", "high", "critical"].includes(level) ? 2 : 1;
  let bodyStart = payloadStart;
  for (let skipped = 0; skipped < headerLines; skipped++) {
    const nl = source.indexOf("\n", bodyStart);
    if (nl === -1) return;
    bodyStart = nl + 1;
  }
  const body = lines.slice(headerLines).join("\n");
  if (source.slice(bodyStart, bodyStart + body.length) !== body) return;
  const inner = scanDoc(body);
  for (const link of inner.links) {
    const shifted: ExtractedLink = {
      ...link,
      line: link.line + source.slice(0, bodyStart).split("\n").length - 1,
    };
    if (link.targetSpan !== undefined) {
      shifted.targetSpan = {
        start: link.targetSpan.start + bodyStart,
        end: link.targetSpan.end + bodyStart,
      };
    }
    scan.links.push(shifted);
  }
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

// ---- Tags -------------------------------------------------------------------

// An inline `#tag`: `#` at a word boundary (not glued to a preceding word char,
// `#`, or `/` — so `C#`, `##h`, and url fragments don't count) followed by a
// LETTER-first name (excludes `#123` and fully-numeric hex like `#123456`).
// Nested `a/b/c` and dashes are allowed; a trailing `/` or `-` is not captured.
// Unicode letters/numbers count — the pipeline already runs with the `u` flag
// (search-index tokenizer), so it costs nothing here.
// Module-private: the pattern alone is not the grammar — the trailing-dash trim
// below is part of it — so `inlineTagSpans` is the only seam a second consumer
// gets. Stateful (`g` flag): scan it with `matchAll`.
const INLINE_TAG_RE = /(?<![\p{L}\p{N}_/#])#(\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*)/gu;

/** A `#tag` occurrence inside one text run: `[start, end)` covers the `#` and
 * the tag name, and `tag` is the name alone. */
export type InlineTagSpan = { start: number; end: number; tag: string };

/** Every `#tag` in one plain-text run, in order — the ONE inline-tag scanner.
 * Pure string math, no mdast: the index walks mdast `text` nodes and the
 * editor's chip decoration walks Slate text runs, so the WALKERS genuinely
 * can't be shared, but the token grammar must not drift between them, so both
 * come through here. */
export function inlineTagSpans(text: string): InlineTagSpan[] {
  const spans: InlineTagSpan[] = [];
  for (const match of text.matchAll(INLINE_TAG_RE)) {
    const start = match.index;
    const raw = match[1];
    if (start === undefined || raw === undefined) continue;
    // A trailing dash is captured by the name class but reads as punctuation,
    // not part of the tag (`#bar-` → `bar`); a trailing `/` never is.
    const tag = raw.replace(/-+$/, "");
    if (tag === "") continue;
    spans.push({ start, end: start + 1 + tag.length, tag });
  }
  return spans;
}

/** The leading `yaml` node's typed properties, parsed ONCE per scanDoc pass,
 * or null when the doc has no frontmatter block. Each `frontmatter*` extractor
 * below keeps its own none/invalid default mapping over this shared result. */
function parseFrontmatter(tree: Nodes): ParsedProperties | null {
  if (!("children" in tree)) return null;
  const yaml = tree.children.find((child) => child.type === "yaml");
  if (!yaml || yaml.type !== "yaml") return null;
  return parseProperties(yaml.value);
}

/** The doc's tags: frontmatter `tags` (declaration order) then inline `#tag`
 * tokens (document order). Inline extraction is PARSE-AWARE — it scans only
 * mdast `text` nodes, so code spans/fences (their own `inlineCode`/`code`
 * nodes), link/image URLs (a node's `url`, never text), and link/image LABELS
 * (their subtrees are suppressed) are all naturally excluded, no byte regex. */
function extractTags(tree: Nodes, frontmatter: ParsedProperties | null): string[] {
  const tags = [...frontmatterTags(frontmatter)];
  collectInlineTags(tree, tags, false);
  return tags;
}

/** The parsed frontmatter's `tags` property (017's typed tags: a string
 * array). A leading `#` on a frontmatter tag is tolerated and stripped. */
function frontmatterTags(parsed: ParsedProperties | null): string[] {
  if (parsed === null || parsed.kind !== "valid") return [];
  const prop = parsed.properties.find((p) => p.key === "tags" && p.type === "tags");
  if (!prop || prop.type !== "tags") return [];
  return prop.value.map((tag) => tag.replace(/^#/, "").trim()).filter((tag) => tag !== "");
}

/** The parsed frontmatter's `aliases` property — Obsidian's alias
 * list. The canonical form is a plain string array (which classifies as the
 * existing 'tags' TypedProperty, so the properties panel round-trips it for
 * free); for Obsidian interop a single-string scalar and the legacy `alias:`
 * key are accepted too. Values are trimmed, empties dropped, and deduped
 * case-insensitively keeping the first display case (TagIndex's identity
 * rule). Anything else — malformed yaml, non-string values — degrades to []. */
function frontmatterAliases(parsed: ParsedProperties | null): string[] {
  if (parsed === null || parsed.kind !== "valid") return [];
  const prop =
    parsed.properties.find((p) => p.key === "aliases") ??
    parsed.properties.find((p) => p.key === "alias");
  if (!prop) return [];
  // "tags" = string array; "text"/"date" = a single string scalar (a date
  // alias like `2026-07-01` classifies as date but is still a string).
  const values =
    prop.type === "tags"
      ? prop.value
      : prop.type === "text" || prop.type === "date"
        ? [prop.value]
        : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const alias = raw.trim();
    if (alias === "") continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** Walk `text` nodes for `#tag` tokens; suppress link/image subtrees so a
 * `[label #not-a-tag](url)` label is never mistaken for a tag. */
function collectInlineTags(node: Nodes, out: string[], suppressed: boolean): void {
  if (node.type === "text") {
    if (suppressed) return;
    for (const { tag } of inlineTagSpans(node.value)) out.push(tag);
    return;
  }
  const nextSuppressed =
    suppressed ||
    node.type === "link" ||
    node.type === "linkReference" ||
    node.type === "image" ||
    node.type === "imageReference";
  if ("children" in node) {
    for (const child of node.children) collectInlineTags(child, out, nextSuppressed);
  }
}

// ---- Tasks ------------------------------------------------------------------

/** The parsed frontmatter's `tasks: false` opt-out — a strict-boolean checkbox
 * property defaulting OPEN: only an explicit `tasks: false` suppresses
 * extraction (malformed frontmatter changes nothing — suppressing tasks is a
 * preference, not a safety property). */
function frontmatterTasksDisabled(parsed: ParsedProperties | null): boolean {
  if (parsed === null || parsed.kind !== "valid") return false;
  const prop = parsed.properties.find((p) => p.key === "tasks");
  return prop !== undefined && prop.type === "checkbox" && !prop.value;
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
