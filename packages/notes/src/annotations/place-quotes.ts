// Where a highlight made away from the editor lands in the item's text, on whichever device fills
// it: a quote is matched in the text a person reads (passage-text.ts), whitespace folded, at its
// n-th occurrence and across blocks, and its markers are SPLICED into the bytes around it, so
// taking them out gives back the input exactly and two devices placing one quote write the same
// bytes. An edge never splits what the editor reads as one piece: inside an atomic inline it
// widens to the inline's edge, and it moves past any offset where a marker would read as something
// else (after a backslash, beside a literal `*`/`_`/`~`, inside a word, in a bare url's tail).
// Quotes landing on one range share one marker pair. With `final`, what found no passage is
// appended under a trailing `## Highlights` heading, each quote a blockquote its markers wrap, its
// text escaped.

import { splitMarkerIds } from "../markdown/remark-inline-constructs";

import { markerRootIds } from "./marker-ids";
import { annotationPassages, projectPassages } from "./passage-text";
import type { PassageProjection } from "./passage-text";
import { escapePhrasingText } from "./phrasing-escape";
import type { AnnotationStore } from "./store-schema";

export interface PendingQuote {
  id: string;
  quote: string;
  // 1 is the first; a quote occurring fewer times is missing
  occurrence?: number | undefined;
}

export interface QuotePlacement {
  content: string;
  // markers now wrap these in the text, those already wrapped included
  placed: string[];
  // under `## Highlights` (`final` only)
  appended: string[];
  // found nowhere, and nothing written for them (never with `final`)
  missing: string[];
}

const ASCII_WORD = /[A-Za-z0-9]/u;
const LINE_BREAK = /[\r\n]/u;

const foldQuote = (quote: string): string => quote.replaceAll(/\s+/gu, " ").trim();

// a marker spliced at this offset would not read back as a marker beside the same text
const unsafeAt = (projection: PassageProjection, offset: number): boolean => {
  const { source } = projection;
  let slashes = 0;
  while (source[offset - 1 - slashes] === "\\") {
    slashes += 1;
  }
  return (
    slashes % 2 === 1 ||
    projection.delimiters.has(offset - 1) ||
    projection.delimiters.has(offset) ||
    projection.urlTails.some((tail) => offset >= tail.start && offset <= tail.end) ||
    (ASCII_WORD.test(source[offset - 1] ?? "") && ASCII_WORD.test(source[offset] ?? ""))
  );
};

// the start marker's offset for a match starting at `index`, widened left within its block
const startOffset = (projection: PassageProjection, index: number): number | null => {
  const block = projection.block[index];
  for (let at = index; at >= 0 && projection.block[at] === block; at -= 1) {
    const offset = projection.from[at] ?? -1;
    if (offset >= 0 && !unsafeAt(projection, offset)) {
      return offset;
    }
  }
  return null;
};

// the end marker's offset for a match ending at `index` (its last character), widened right within
// its block; never right after a line break, where a quote's or a list's prefix follows
const endOffset = (projection: PassageProjection, index: number): number | null => {
  const block = projection.block[index];
  for (let at = index; at < projection.text.length && projection.block[at] === block; at += 1) {
    const offset = projection.to[at] ?? -1;
    if (
      offset >= 0 &&
      !unsafeAt(projection, offset) &&
      !LINE_BREAK.test(projection.source[offset - 1] ?? "")
    ) {
      return offset;
    }
  }
  return null;
};

const occurrenceAt = (text: string, quote: string, occurrence: number): number => {
  let at = -1;
  for (let found = 0; found < occurrence; found += 1) {
    at = text.indexOf(quote, at + 1);
    if (at === -1) {
      return -1;
    }
  }
  return at;
};

interface Range {
  start: number;
  end: number;
  ids: string[];
}

const rangeOf = (
  projection: PassageProjection,
  quote: string,
  occurrence: number,
): { start: number; end: number } | null => {
  const folded = foldQuote(quote);
  if (folded === "" || occurrence < 1) {
    return null;
  }
  const at = occurrenceAt(projection.text, folded, occurrence);
  if (at === -1) {
    return null;
  }
  const start = startOffset(projection, at);
  const end = endOffset(projection, at + folded.length - 1);
  return start === null || end === null || end <= start ? null : { end, start };
};

interface Insertion {
  offset: number;
  text: string;
  // at one offset ends go before starts; an inner range ends first and an outer one starts first
  kind: 0 | 1;
  rank: number;
}

const splice = (source: string, ranges: readonly Range[]): string => {
  const insertions: Insertion[] = ranges.flatMap((range) => {
    const ids = range.ids.join(",");
    return [
      { kind: 1, offset: range.start, rank: -range.end, text: `%%i:${ids}:start%%` },
      { kind: 0, offset: range.end, rank: -range.start, text: `%%i:${ids}:end%%` },
    ] satisfies Insertion[];
  });
  insertions.sort((a, b) => a.offset - b.offset || a.kind - b.kind || a.rank - b.rank);
  let out = "";
  let cursor = 0;
  for (const insertion of insertions) {
    out += source.slice(cursor, insertion.offset) + insertion.text;
    cursor = insertion.offset;
  }
  return out + source.slice(cursor);
};

const lineEnding = (source: string): string => (source.includes("\r\n") ? "\r\n" : "\n");

// the dialect reads a bare url out of text up to the next space, so a quote ending in one keeps a
// space before its end marker, which the url would otherwise take in
const ENDS_IN_URL = /(?:https?:\/\/|www\.)\S*$/iu;

// inside a bare url the editor writes the url's own characters, since the dialect reads a url out
// of text whatever its escapes; a `%` or `{` keeps its escape, which a marker or a pill needs even
// there
const unescapedUrl = (bytes: string): string =>
  bytes.replaceAll(/\\(?<character>[!-/:-@[-`{-~])/gu, (escape, character: string) =>
    character === "%" || character === "{" || character === "\\" ? escape : character,
  );

const highlightParagraph = (id: string, quote: string): string => {
  const text = escapePhrasingText(quote, { after: "%", before: "%" });
  const gap = ENDS_IN_URL.test(quote) ? " " : "";
  const escaped = `> %%i:${id}:start%%${text}${gap}%%i:${id}:end%%`;
  const { bareUrls } = projectPassages(escaped);
  if (bareUrls.length === 0) {
    return escaped;
  }
  let raw = "";
  let cursor = 0;
  for (const url of bareUrls) {
    raw += escaped.slice(cursor, url.start) + unescapedUrl(escaped.slice(url.start, url.end));
    cursor = url.end;
  }
  raw += escaped.slice(cursor);
  // a url's own characters are written only where they still read back as the quote
  return annotationPassages(raw).get(id) === annotationPassages(escaped).get(id) ? raw : escaped;
};

// `## Highlights` (unless the text already ends in that section) and one quoted, marked paragraph
// per quote, a blank line under what the text ends with
const appendHighlights = (
  projection: PassageProjection,
  content: string,
  quotes: readonly { id: string; quote: string }[],
): string => {
  const eol = lineEnding(content);
  const blocks = quotes.map(({ id, quote }) => highlightParagraph(id, foldQuote(quote)));
  const section = [...(projection.endsInHighlights ? [] : ["## Highlights"]), ...blocks].join(
    `${eol}${eol}`,
  );
  if (content === "") {
    return `${section}${eol}`;
  }
  let gap = `${eol}${eol}`;
  if (content.endsWith(`${eol}${eol}`)) {
    gap = "";
  } else if (content.endsWith(eol)) {
    gap = eol;
  }
  return `${content}${gap}${section}${eol}`;
};

export const placeQuotes = (
  content: string,
  pending: readonly PendingQuote[],
  options: { final: boolean },
): QuotePlacement => {
  const projection = projectPassages(content);
  const placed: string[] = [];
  const missing: PendingQuote[] = [];
  const ranges = new Map<string, Range>();
  for (const quote of pending) {
    if (projection.markers.has(quote.id)) {
      placed.push(quote.id);
      continue;
    }
    const range = rangeOf(projection, quote.quote, quote.occurrence ?? 1);
    if (range === null) {
      missing.push(quote);
      continue;
    }
    placed.push(quote.id);
    const key = `${range.start}:${range.end}`;
    const shared = ranges.get(key);
    if (shared === undefined) {
      ranges.set(key, { ...range, ids: [quote.id] });
    } else {
      shared.ids.push(quote.id);
    }
  }
  const spliced = ranges.size === 0 ? content : splice(content, [...ranges.values()]);
  const appendable = options.final ? missing.filter((quote) => foldQuote(quote.quote) !== "") : [];
  const appended = appendable.map((quote) => quote.id);
  return {
    appended,
    content:
      appendable.length === 0
        ? spliced
        : appendHighlights(projectPassages(spliced), spliced, appendable),
    missing: missing.map((quote) => quote.id).filter((id) => !appended.includes(id)),
    placed,
  };
};

// the markers naming any of `ids` spliced out: a pair the ids share with others keeps the others
export const stripAnnotationMarkers = (content: string, ids: readonly string[]): string => {
  const removing = new Set(ids);
  let out = "";
  let cursor = 0;
  for (const marker of projectPassages(content).markerSpans) {
    const listed = splitMarkerIds(marker.ids);
    if (!listed.some((id) => removing.has(id))) {
      continue;
    }
    const kept = listed.filter((id) => !removing.has(id));
    out += content.slice(cursor, marker.start);
    out += kept.length === 0 ? "" : `%%i:${kept.join(",")}:${marker.edge}%%`;
    cursor = marker.end;
  }
  return out + content.slice(cursor);
};

// the roots still waiting for their passage: a quote, and no markers in the text yet, oldest first
// so every device places one item's highlights in one order
export const waitingQuotes = (store: AnnotationStore, content: string): PendingQuote[] => {
  const anchored = markerRootIds(content);
  return Object.entries(store)
    .filter(
      ([id, entry]) =>
        entry.parentId === undefined && entry.quote !== undefined && !anchored.has(id),
    )
    .toSorted(([a, left], [b, right]) => left.createdAt - right.createdAt || a.localeCompare(b))
    .map(([id, entry]) => ({ id, quote: entry.quote ?? "" }));
};
