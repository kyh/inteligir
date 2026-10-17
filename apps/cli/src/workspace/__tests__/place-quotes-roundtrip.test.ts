// asserted here rather than beside the placement: the editor's fixpoint serializer is the page's,
// and this program compiles both. A placement only splices markers, so a canonical item stays
// canonical with its highlights in it; the one restyle the editor makes is a table's padding, since
// a marker widens its cell. A Highlights section written for a quote with no passage is the editor's
// own spelling, whatever the quote holds.

import { describe, expect, it } from "vitest";

import { analyzeMarkdown, gateReasonFor, toCanonical } from "@repo/editor/markdown/markdown-doc";
import { markerRootIds } from "@repo/notes/annotations/marker-ids";

import {
  canonicalCorpus,
  quotesOf,
  seededRandom,
} from "../../server/annotations/__tests__/quote-corpus";
import { annotationPassages } from "../../server/annotations/passage-text";
import { placeQuotes } from "../../server/annotations/place-quotes";

const TABLE_ROW = /^(?:> )*\|/u;

// the lines the editor rewrote; a table row's padding is the only rewrite a marker may cause
const rewrittenLines = (placed: string, canonical: string): string[] => {
  const before = placed.split("\n");
  const after = canonical.split("\n");
  return before.filter((line, index) => line !== after[index]);
};

describe("the editor keeps a placed highlight's bytes", () => {
  const random = seededRandom(17);
  const cases = canonicalCorpus().flatMap((doc) =>
    quotesOf(doc.content, random, 10).map((quote, index) => ({ ...doc, id: `q${index}`, quote })),
  );

  it.each(cases)("$name: “$quote”", ({ content, id, quote }) => {
    const placed = placeQuotes(content, [{ id, quote }], { final: false });
    const canonical = toCanonical(placed.content);
    expect(markerRootIds(canonical)).toEqual(markerRootIds(placed.content));
    const rewritten = rewrittenLines(placed.content, canonical);
    expect(
      rewritten.every((line) => TABLE_ROW.test(line)),
      rewritten.join("\n"),
    ).toBe(true);
    if (rewritten.length === 0) {
      expect(analyzeMarkdown(placed.content).kind).toBe("canonical");
    }
  });
});

// characters a page's text could carry that the dialect reads as something
const RISKY = [
  "*",
  "_",
  "`",
  "[",
  "]",
  "(",
  ")",
  "<",
  ">",
  "!",
  "#",
  "&",
  "{",
  "}",
  "%",
  "@",
  "$",
  "|",
  "~",
  "\\",
  ":",
  ".",
  "-",
  "+",
  "=",
  "'",
  '"',
];
const WORDS = ["a", "word", "2026-01-02", "i:abc:end", "abc", "x1"];
const URLS = ["https://x.com", "www.y.org", "q@r.st"];

const hostileQuote = (random: () => number, words: readonly string[]): string => {
  const parts: string[] = [];
  const length = 1 + Math.floor(random() * 12);
  for (let index = 0; index < length; index += 1) {
    const pool = random() < 0.6 ? RISKY : words;
    parts.push(pool[Math.floor(random() * pool.length)] ?? "");
    if (random() < 0.3) {
      parts.push(" ");
    }
  }
  return parts.join("").trim();
};

const fold = (quote: string): string => quote.replaceAll(/\s+/gu, " ").trim();

const highlighted = (quote: string): string => {
  const placed = placeQuotes("", [{ id: "h1", quote }], { final: true });
  expect(placed.appended).toEqual(["h1"]);
  expect(markerRootIds(placed.content)).toEqual(new Set(["h1"]));
  expect(annotationPassages(placed.content).get("h1")).toBe(fold(quote));
  return placed.content;
};

describe("a quote under Highlights reads back as itself, in the editor's own spelling", () => {
  const random = seededRandom(4242);
  const quotes = [
    "[x](javascript:alert(1)) <img src=x onerror=y> {{1+1|2}} %%i:zz:start%% @2026-10-17",
    "*emphasis* _under_ **strong** ~~gone~~ `code` $$m$$ [[Wiki]] ![[embed]] #tag",
    "1. not a list - nor this + nor > quote | pipe & &amp; \\* \\",
    "Read https://stephango.com/file-over-app and www.example.org, or mail q@r.st.",
    "It ends with a link https://example.com/a?b=c",
    ...Array.from({ length: 200 }, () => hostileQuote(random, WORDS)).filter(
      (quote) => quote !== "",
    ),
  ];

  it.each(quotes)("%s", (quote) => {
    const content = highlighted(quote);
    expect(toCanonical(content)).toBe(content);
    expect(analyzeMarkdown(content).kind).toBe("canonical");
  });
});

// the dialect reads a bare url out of text up to the next space whatever its escapes, and the
// editor writes what it read as the url's own characters, so a url packed among punctuation may be
// respelled on the first save, or opened raw where the editor cannot settle one; either way the
// highlight and its markers survive
describe("a quote packed with bare urls keeps its highlight through the editor", () => {
  const random = seededRandom(99);
  const quotes = Array.from({ length: 200 }, () =>
    hostileQuote(random, [...WORDS, ...URLS]),
  ).filter((quote) => quote !== "");

  it.each(quotes)("%s", (quote) => {
    const content = highlighted(quote);
    if (gateReasonFor(analyzeMarkdown(content)) === null) {
      expect(markerRootIds(toCanonical(content))).toEqual(new Set(["h1"]));
    }
  });
});
