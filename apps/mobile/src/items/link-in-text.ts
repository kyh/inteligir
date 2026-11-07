// A web link inside typed or shared text, up to the first space. The punctuation a sentence puts
// after a link is the sentence's, and so is a closing bracket the link never opened: "(see
// https://x.y/z)" saves https://x.y/z, while https://en.wikipedia.org/wiki/Foo_(bar) keeps its
// own. The marks are the keyboard's as well as ASCII's: iOS types “ ” for ", an ellipsis, and a
// full-width keyboard its own brackets and stops. Pure: `phone-saves.ts`, `share-payload.ts` and
// the tests read it.

import { isWebUrl, urlKey } from "@repo/notes/items/item-url";

// quotes never sit inside a link someone typed, so one ends it; ’ may (smart punctuation types
// it for an apostrophe), so it ends a link only as its last mark
const LINK_IN_TEXT = /https?:\/\/[^\s<>"'`“”‘«»「」『』]+/giu;
const SENTENCE_PUNCTUATION = new Set([
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

// a closing bracket ends the link only while the link holds fewer of its opener than of it
const linkTail = (candidate: string): string => {
  let url = candidate;
  for (let last = url.at(-1); last !== undefined; last = url.at(-1)) {
    const opener = OPENER_OF.get(last);
    const sentence =
      SENTENCE_PUNCTUATION.has(last) ||
      (opener !== undefined && countOf(url, last) > countOf(url, opener));
    if (!sentence) {
      break;
    }
    url = url.slice(0, -1);
  }
  return url;
};

// the text before the link without the openers of the closers its tail gave the sentence back:
// each closer takes the nearest opener of its kind that nothing before the link closed
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

// the punctuation after a closing quote is the link's, as it is with no quote between them
const pastPunctuation = (text: string): string => {
  const words = [...text].findIndex((ch) => !SENTENCE_PUNCTUATION.has(ch));
  return words === -1 ? "" : text.slice(words);
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
const restAround = (before: string, tail: string, after: string): string => {
  let head = before;
  let closers = [...tail].filter((ch) => OPENER_OF.has(ch));
  const markdown = /\[(?<label>[^\]]*)\]\($/u.exec(head);
  if (markdown !== null && closers[0] === ")") {
    head = `${head.slice(0, markdown.index)}${markdown.groups?.label ?? ""}`;
    closers = closers.slice(1);
  }
  head = withoutOpenersOf(head, closers);
  let next = after;
  // ’ can end the link's own tail, where the sentence already took it
  const quote = QUOTE_CLOSER_OF.get(head.at(-1) ?? "");
  if (quote !== undefined && (tail.includes(quote) || next.startsWith(quote))) {
    head = head.slice(0, -1);
    next = tail.includes(quote) ? next : pastPunctuation(next.slice(quote.length));
  }
  const left = head.trim();
  const right = next.trim();
  return left === "" || right === "" ? `${left}${right}` : `${left}${seamOf(head, next)}${right}`;
};

const textWithout = (text: string, found: RegExpExecArray, url: string): string =>
  restAround(
    text.slice(0, found.index),
    found[0].slice(url.length),
    text.slice(found.index + found[0].length),
  );

export const linkInText = (text: string): { url: string; rest: string } | null => {
  const [found] = text.matchAll(LINK_IN_TEXT);
  if (found === undefined) {
    return null;
  }
  const url = linkTail(found[0]);
  return isWebUrl(url) ? { rest: textWithout(text, found, url), url } : null;
};

// the text with every spelling of `url` taken out, each as `linkInText` takes the first link out
export const withoutLink = (text: string, url: string): string => {
  const key = urlKey(url);
  for (const found of text.matchAll(LINK_IN_TEXT)) {
    const spelling = linkTail(found[0]);
    if (key !== null && urlKey(spelling) === key) {
      return withoutLink(textWithout(text, found, spelling), url);
    }
  }
  return text;
};
