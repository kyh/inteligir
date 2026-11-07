// A web link inside typed or shared text, up to the first thing no address holds. The punctuation
// a sentence puts after a link is the sentence's, and so is a closing bracket the link never
// opened: "(see https://x.y/z)" saves https://x.y/z, while https://en.wikipedia.org/wiki/Foo_(bar)
// keeps its own. The marks are the keyboard's as well as ASCII's: iOS types “ ” for ", an ellipsis,
// and a full-width keyboard its own brackets and stops. Pure: `phone-saves.ts`, `share-payload.ts`
// and the tests read it.

import { isWebUrl, urlKey } from "@repo/notes/items/item-url";

// letters of any script, numbers, the ASCII an address spells and the full-width brackets it can
// hold. A quote, an emoji, a dash or a full-width stop never sits inside a link someone typed, and
// a language with no spaces runs its sentence straight on from the link, so each ends it; ’ may
// (smart punctuation types it for an apostrophe), so it ends a link only as its last mark
const LINK_IN_TEXT =
  /https?:\/\/[\p{L}\p{N}\p{M}!#$%&()*+,\-./:;=?@[\\\]^_{|}~’（）［］｛｝【】〈〉《》]+/giu;
const SENTENCE_PUNCTUATION = new Set([
  "*",
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "…",
  "’",
  "。",
  "、",
  "，",
  "；",
  "：",
  "！",
  "？",
]);
const OPENER_OF: ReadonlyMap<string, string> = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
  ["）", "（"],
  ["］", "［"],
  ["｝", "｛"],
  ["】", "【"],
  ["〉", "〈"],
  ["》", "《"],
]);
const CLOSER_OF: ReadonlyMap<string, string> = new Map(
  [...OPENER_OF].map(([closer, opener]) => [opener, closer]),
);
// a quote around the link is the sentence's too
const QUOTE_CLOSER_OF: ReadonlyMap<string, string> = new Map([
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
  ["「", "」"],
  ["『", "』"],
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["<", ">"],
]);

const countOf = (text: string, ch: string): number => text.split(ch).length - 1;

// the link in what the search found: up to a closing bracket it never opened, whatever follows
// that, and short of the punctuation a sentence puts after it
const linkOf = (found: string): string => {
  const open = new Map<string, number>();
  let end = 0;
  for (const ch of found) {
    const opener = OPENER_OF.get(ch);
    if (opener !== undefined && (open.get(opener) ?? 0) === 0) {
      break;
    }
    const bracket = opener ?? ch;
    if (CLOSER_OF.has(bracket)) {
      open.set(bracket, (open.get(bracket) ?? 0) + (opener === undefined ? 1 : -1));
    }
    end += ch.length;
  }
  let url = found.slice(0, end);
  while (SENTENCE_PUNCTUATION.has(url.at(-1) ?? "")) {
    url = url.slice(0, -1);
  }
  return url;
};

// the text before the link without the openers of the closers straight after it: each closer takes the nearest opener of its kind that nothing before the link closed
const withoutOpenersOf = (before: string, closers: readonly string[]): string => {
  const open = new Map<string, number[]>();
  for (const [index, ch] of [...before].entries()) {
    if (CLOSER_OF.has(ch)) {
      open.set(ch, [...(open.get(ch) ?? []), index]);
    } else {
      const opener = OPENER_OF.get(ch);
      open.get(opener ?? "")?.pop();
    }
  }
  const dropped = new Set<number>();
  for (const closer of closers) {
    const at = open.get(OPENER_OF.get(closer) ?? "")?.pop();
    if (at !== undefined) {
      dropped.add(at);
    }
  }
  return [...before].filter((_, index) => !dropped.has(index)).join("");
};

// the marks a sentence puts straight after a link: its punctuation and its closing brackets
const marksAt = (text: string): string => {
  const words = [...text].findIndex((ch) => !SENTENCE_PUNCTUATION.has(ch) && !OPENER_OF.has(ch));
  return words === -1 ? text : text.slice(0, words);
};

// what joins the words the link stood between: the line breaks they had, the most on either side,
// since the link's own line goes with it, or a space
const seamOf = (before: string, after: string): string => {
  const breaks = Math.max(
    countOf(before.slice(before.trimEnd().length), "\n"),
    countOf(after.slice(0, after.length - after.trimStart().length), "\n"),
  );
  return breaks === 0 ? " " : "\n".repeat(breaks);
};

// the note: the text around the link, less the marks that framed it. A markdown link's label is
// the note, and a bracket or a quote the link sat in goes with the link
const restAround = (before: string, after: string): string => {
  const marks = marksAt(after);
  const next = after.slice(marks.length);
  let head = before;
  let closers = [...marks].filter((ch) => OPENER_OF.has(ch));
  const markdown = /\[(?<label>[^\]]*)\]\($/u.exec(head);
  if (markdown !== null && closers[0] === ")") {
    head = `${head.slice(0, markdown.index)}${markdown.groups?.label ?? ""}`;
    closers = closers.slice(1);
  }
  head = withoutOpenersOf(head, closers);
  // ’ can be among the marks, which took it for the sentence's; any other quote closes after them,
  // and the marks past it are the link's too
  const quote = QUOTE_CLOSER_OF.get(head.at(-1) ?? "");
  if (quote !== undefined && (marks.includes(quote) || next.startsWith(quote))) {
    return restAround(head.slice(0, -1), marks.includes(quote) ? next : next.slice(quote.length));
  }
  const left = head.trim();
  const right = next.trim();
  return left === "" || right === "" ? `${left}${right}` : `${left}${seamOf(head, next)}${right}`;
};

// the text with every spelling of `url` taken out, and the marks that framed each
export const withoutLink = (text: string, url: string): string => {
  const key = urlKey(url);
  for (const found of text.matchAll(LINK_IN_TEXT)) {
    const spelling = linkOf(found[0]);
    if (key !== null && urlKey(spelling) === key) {
      const after = text.slice(found.index + spelling.length);
      return withoutLink(restAround(text.slice(0, found.index), after), url);
    }
  }
  return text;
};

export const linkInText = (text: string): { url: string; rest: string } | null => {
  const [found] = text.matchAll(LINK_IN_TEXT);
  if (found === undefined) {
    return null;
  }
  const url = linkOf(found[0]);
  return isWebUrl(url) ? { rest: withoutLink(text, url), url } : null;
};
