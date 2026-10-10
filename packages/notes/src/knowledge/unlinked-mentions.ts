// A plain-text mention is a name the wiki grammar would resolve, written without the brackets:
// the doc's link name or one of its aliases, as a whole word, any case. Not its H1: `[[H1 text]]`
// resolves to nothing unless that text is also the link name or an alias. Bytes the editor treats as
// verbatim, code, links, urls, frontmatter, comment markers and `:::` marker lines are withheld,
// because a "mention" there is not prose and a Link would rewrite something that is not a sentence.

import type { Nodes } from "mdast";

import { parseBare } from "../markdown/bare-parse";
import { frontmatterEnd } from "../markdown/frontmatter";
import { isMarkerLine } from "../markdown/remark-containers";
import { COMMENT_MARKER_STRIP_RE } from "../markdown/remark-inline-constructs";
import { isOpaqueSource } from "../markdown/remark-opaque";
import { serializeWikiBody } from "../markdown/remark-wiki-link";
import { splitLinesKeepingTerminators } from "../text/source-lines";
import { wikiLinkName } from "./doc-file";
import { wikiTargetForPath } from "./link-resolve";
import { anyWholeWordMatcher, excerptAround, findLineMatches } from "./text-matches";
import type { DocText, TextMatch } from "./text-matches";

export interface UnlinkedMention {
  path: string;
  title: string;
  // the first plain mention in document order: the bytes a Link rewrites
  line: number;
  column: number;
  length: number;
  before: string;
  text: string;
  after: string;
  // every plain mention in the doc, the first included
  count: number;
}

// `total` counts every mentioning doc; `mentions` stops at the caller's limit
export interface UnlinkedMentions {
  mentions: UnlinkedMention[];
  total: number;
}

// the rows beside the target every Link writes; null when no wiki link can name the note
export interface LinkableMentions extends UnlinkedMentions {
  linkTarget: string | null;
}

export const mentionLinkTarget = (
  path: string,
  resolveWiki: (target: string) => string | null,
): string | null => {
  const target = wikiTargetForPath(path, resolveWiki);
  return serializeWikiBody({ target }) === null ? null : target;
};

export interface UnlinkedMentionQuery {
  names: readonly string[];
  // the target itself and every doc that already links to it
  exclude: ReadonlySet<string>;
  limit: number;
}

// Link keeps the prose as the link's alias, so a name no alias can carry (a bracket, a `|`) is
// not a mention: its row would offer a Link that cannot be written
const showableInLink = (name: string): boolean =>
  serializeWikiBody({ alias: name, target: "" }) !== null;

export const mentionNames = (path: string, aliases: readonly string[]): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of [wikiLinkName(path), ...aliases]) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name === "" || seen.has(key) || !showableInLink(name)) {
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return names;
};

const FENCE = /^(?:`{3,}|~{3,}|\$\$)/u;
const INLINE_CODE = /`+[^`\n]*`+/gu;
const WIKI_LINK = /!?\[\[[^\]]*\]\]/gu;
const MD_LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/gu;
const URL = /<?(?:https?|mailto):[^\s>]+>?/gu;
const INLINE_MATH = /\$[^$\n]+\$/gu;
const HTML_TAG = /<\/?[A-Za-z][^>\n]*>/gu;
const INLINE_WITHHELD = [
  INLINE_CODE,
  WIKI_LINK,
  MD_LINK,
  URL,
  COMMENT_MARKER_STRIP_RE,
  INLINE_MATH,
  HTML_TAG,
];

// a quote's or a list item's own markers ahead of a line's text
const LINE_PREFIX = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?/u;

interface Span {
  start: number;
  end: number;
}

// neither math nor a tag the editor carries as its source string can open without one of these,
// so a doc holding none skips the parse
const VERBATIM_OPENER = /[<$]/u;

// what the editor's grammar holds as a string it never reads as prose: math's latex, and every
// construct it carries as its source
const collectVerbatim = (node: Nodes, out: Span[]): void => {
  if (node.type === "math" || node.type === "inlineMath" || isOpaqueSource(node)) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      out.push({ end, start });
    }
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectVerbatim(child, out);
    }
  }
};

const insideAny = (spans: readonly Span[], start: number, end: number): boolean =>
  spans.some((span) => start >= span.start && end <= span.end);

// absolute offsets a mention may not sit inside: the editor's verbatim ranges plus, read line by
// line, the markdown constructs that are not a sentence (code, links, urls, comment markers, and
// math and html tags again)
const withheldSpansOf = (body: string, parts: readonly string[]): Span[] => {
  const spans: Span[] = [];
  if (VERBATIM_OPENER.test(body)) {
    collectVerbatim(parseBare(body), spans);
  }
  const header = frontmatterEnd(body);
  if (header !== null) {
    spans.push({ end: header, start: 0 });
  }
  let offset = 0;
  let fenceStart: number | null = null;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (index % 2 === 0) {
      if (FENCE.test(part)) {
        if (fenceStart === null) {
          fenceStart = offset;
        } else {
          spans.push({ end: offset + part.length, start: fenceStart });
          fenceStart = null;
        }
      } else if (fenceStart === null) {
        if (isMarkerLine(part.replace(LINE_PREFIX, "").trimEnd())) {
          spans.push({ end: offset + part.length, start: offset });
        } else {
          for (const pattern of INLINE_WITHHELD) {
            for (const hit of part.matchAll(pattern)) {
              spans.push({ end: offset + hit.index + hit[0].length, start: offset + hit.index });
            }
          }
        }
      }
    }
    offset += part.length;
  }
  // an unclosed fence runs to the end of the doc, as the parser reads it
  if (fenceStart !== null) {
    spans.push({ end: body.length, start: fenceStart });
  }
  return spans;
};

export const withheldSpans = (body: string): Span[] =>
  withheldSpansOf(body, splitLinesKeepingTerminators(body));

const lineStarts = (parts: readonly string[]): number[] => {
  const starts: number[] = [];
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 0) {
      starts.push(offset);
    }
    offset += (parts[index] ?? "").length;
  }
  return starts;
};

// in document order, since the one pattern scans each line left to right
const plainMentions = (body: string, parts: readonly string[], pattern: RegExp): TextMatch[] => {
  const raw = findLineMatches(parts, pattern);
  if (raw.length === 0) {
    return [];
  }
  const withheld = withheldSpansOf(body, parts);
  const starts = lineStarts(parts);
  return raw.filter((match) => {
    const start = (starts[match.line - 1] ?? 0) + match.column;
    return !insideAny(withheld, start, start + match.length);
  });
};

const byPath = (a: DocText, b: DocText): number => {
  if (a.path < b.path) {
    return -1;
  }
  if (a.path > b.path) {
    return 1;
  }
  return 0;
};

// in path order, so a re-run reads the same
export const findUnlinkedMentions = (
  docs: Iterable<DocText>,
  query: UnlinkedMentionQuery,
): UnlinkedMentions => {
  const mentions: UnlinkedMention[] = [];
  let total = 0;
  const pattern = anyWholeWordMatcher(query.names);
  if (pattern === null) {
    return { mentions, total };
  }
  for (const doc of [...docs].toSorted(byPath)) {
    if (query.exclude.has(doc.path)) {
      continue;
    }
    const parts = splitLinesKeepingTerminators(doc.body);
    const found = plainMentions(doc.body, parts, pattern);
    const [first] = found;
    if (first === undefined) {
      continue;
    }
    total += 1;
    if (mentions.length >= query.limit) {
      continue;
    }
    const line = parts[(first.line - 1) * 2] ?? "";
    mentions.push({
      ...first,
      ...excerptAround(line, first),
      count: found.length,
      path: doc.path,
      title: doc.title,
    });
  }
  return { mentions, total };
};

export type MentionSite = Pick<UnlinkedMention, "line" | "column" | "length" | "text">;

// the exact bytes the row showed become the link, and nothing else moves; bytes that differ
// mean the note changed since the row was read, and that is the caller's to re-read, not guess.
// `target` is `mentionLinkTarget`'s, since the bare name may resolve to another note
export const linkMention = (content: string, site: MentionSite, target: string): string | null => {
  const parts = splitLinesKeepingTerminators(content);
  const index = (site.line - 1) * 2;
  const line = parts[index];
  if (line === undefined) {
    return null;
  }
  const end = site.column + site.length;
  const found = line.slice(site.column, end);
  if (found !== site.text) {
    return null;
  }
  const body = serializeWikiBody(found === target ? { target } : { alias: found, target });
  if (body === null) {
    return null;
  }
  parts[index] = `${line.slice(0, site.column)}[[${body}]]${line.slice(end)}`;
  return parts.join("");
};
