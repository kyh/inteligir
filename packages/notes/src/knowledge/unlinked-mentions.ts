// A plain-text mention is a name the wiki grammar would resolve, written without the brackets:
// the doc's stem or one of its aliases, as a whole word, any case. Not its H1: `[[H1 text]]`
// resolves to nothing unless that text is also the stem or an alias. Bytes the editor treats as
// verbatim, code, links, urls, frontmatter and comment markers are withheld, because a "mention"
// there is not prose and a Link would rewrite something that is not a sentence.

import { insideVerbatim, verbatimSpans, type VerbatimSpan } from "../markdown/verbatim-spans";
import { docStem } from "./doc-file";
import { splitLinesKeepingTerminators } from "./source-lines";
import { excerptAround, findTextMatches, type DocText, type TextMatch } from "./text-matches";

export type UnlinkedMention = {
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
};

// `total` counts every mentioning doc; `mentions` stops at the caller's limit
export type UnlinkedMentions = { mentions: UnlinkedMention[]; total: number };

export type UnlinkedMentionQuery = {
  names: readonly string[];
  // the target itself and every doc that already links to it
  exclude: ReadonlySet<string>;
  limit: number;
};

const MENTION_OPTIONS = { caseSensitive: false, wholeWord: true } as const;

export function mentionNames(path: string, aliases: readonly string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of [docStem(path), ...aliases]) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;
const FENCE = /^(?:`{3,}|~{3,}|\$\$)/u;
const INLINE_CODE = /`+[^`\n]*`+/gu;
const WIKI_LINK = /!?\[\[[^\]]*\]\]/gu;
const MD_LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/gu;
const URL = /<?(?:https?|mailto):[^\s>]+>?/gu;
const COMMENT_MARKER = /%%i:[^%]*%%/gu;
const INLINE_MATH = /\$[^$\n]+\$/gu;
const HTML_TAG = /<\/?[A-Za-z][^>\n]*>/gu;
const INLINE_WITHHELD = [
  INLINE_CODE,
  WIKI_LINK,
  MD_LINK,
  URL,
  COMMENT_MARKER,
  INLINE_MATH,
  HTML_TAG,
];

// absolute offsets a mention may not sit inside: the editor's verbatim ranges plus the
// markdown constructs the scan cannot mistake for prose. the regexes overlap the editor's
// ranges on purpose: those come back empty for a doc its grammar refuses, and a refused doc
// still has code and math the scan must not call a sentence
export function withheldSpans(body: string): VerbatimSpan[] {
  const spans = verbatimSpans(body);
  const frontmatter = FRONTMATTER.exec(body);
  if (frontmatter !== null) spans.push({ start: 0, end: frontmatter[0].length });
  const parts = splitLinesKeepingTerminators(body);
  let offset = 0;
  let fenceStart: number | null = null;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (index % 2 === 0) {
      if (FENCE.test(part)) {
        if (fenceStart === null) {
          fenceStart = offset;
        } else {
          spans.push({ start: fenceStart, end: offset + part.length });
          fenceStart = null;
        }
      } else if (fenceStart === null) {
        for (const pattern of INLINE_WITHHELD) {
          pattern.lastIndex = 0;
          for (let hit = pattern.exec(part); hit !== null; hit = pattern.exec(part)) {
            spans.push({ start: offset + hit.index, end: offset + hit.index + hit[0].length });
          }
        }
      }
    }
    offset += part.length;
  }
  // an unclosed fence runs to the end of the doc, as the parser reads it
  if (fenceStart !== null) spans.push({ start: fenceStart, end: body.length });
  return spans;
}

function lineStarts(parts: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 0) starts.push(offset);
    offset += (parts[index] ?? "").length;
  }
  return starts;
}

function plainMentions(body: string, names: readonly string[]): TextMatch[] {
  const raw = names.flatMap((name) => findTextMatches(body, name, MENTION_OPTIONS));
  if (raw.length === 0) return [];
  const withheld = withheldSpans(body);
  const starts = lineStarts(splitLinesKeepingTerminators(body));
  return raw
    .filter((match) => {
      const start = (starts[match.line - 1] ?? 0) + match.column;
      return !insideVerbatim(withheld, start, start + match.length);
    })
    .toSorted((a, b) => a.line - b.line || a.column - b.column);
}

// in path order, so a re-run reads the same
export function findUnlinkedMentions(
  docs: Iterable<DocText>,
  query: UnlinkedMentionQuery,
): UnlinkedMentions {
  const sorted = [...docs].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const mentions: UnlinkedMention[] = [];
  let total = 0;
  if (query.names.length === 0) return { mentions, total };
  for (const doc of sorted) {
    if (query.exclude.has(doc.path)) continue;
    const found = plainMentions(doc.body, query.names);
    const first = found[0];
    if (first === undefined) continue;
    total += 1;
    if (mentions.length >= query.limit) continue;
    const line = splitLinesKeepingTerminators(doc.body)[(first.line - 1) * 2] ?? "";
    mentions.push({
      ...first,
      ...excerptAround(line, first),
      path: doc.path,
      title: doc.title,
      count: found.length,
    });
  }
  return { mentions, total };
}

export type MentionSite = Pick<UnlinkedMention, "line" | "column" | "length" | "text">;

// the exact bytes the row showed become the link, and nothing else moves; bytes that differ
// mean the note changed since the row was read, and that is the caller's to re-read, not guess
export function linkMention(content: string, site: MentionSite, target: string): string | null {
  const parts = splitLinesKeepingTerminators(content);
  const index = (site.line - 1) * 2;
  const line = parts[index];
  if (line === undefined) return null;
  const end = site.column + site.length;
  const found = line.slice(site.column, end);
  if (found !== site.text) return null;
  const link = found === target ? `[[${target}]]` : `[[${target}|${found}]]`;
  parts[index] = `${line.slice(0, site.column)}${link}${line.slice(end)}`;
  return parts.join("");
}
