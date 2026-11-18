import { isWebUrl, urlKey } from "@repo/contract/items/item-url";

const LINK_IN_TEXT =
  /https?:\/\/[\p{L}\p{N}\p{M}!#$%&'()*+,\-./:;=?@[\\\]^_{|}~’（）［］｛｝【】〈〉《》]+/giu;

const HOST_BEFORE_APOSTROPHE = /^https?:\/\/[^/?#'’]+(?=['’])/iu;

const SENTENCE_PUNCTUATION = new Set([
  "*",
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "…",
  "'",
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

const countOf = (text: string, ch: string) => text.split(ch).length - 1;

const linkOf = (found: string) => {
  const address = HOST_BEFORE_APOSTROPHE.exec(found)?.[0] ?? found;
  const open = new Map<string, number>();
  let end = 0;

  for (const ch of address) {
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

  let url = address.slice(0, end);

  while (SENTENCE_PUNCTUATION.has(url.at(-1) ?? "")) {
    url = url.slice(0, -1);
  }

  return url;
};

const withoutOpenersOf = (before: string, closers: readonly string[]) => {
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

const marksAt = (text: string) => {
  const words = [...text].findIndex(
    (ch, index) =>
      (!SENTENCE_PUNCTUATION.has(ch) && !OPENER_OF.has(ch)) ||
      /^['’][\p{L}\p{N}]/u.test(text.slice(index)),
  );

  return words === -1 ? text : text.slice(0, words);
};

const seamOf = (before: string, after: string) => {
  const breaks = Math.max(
    countOf(before.slice(before.trimEnd().length), "\n"),
    countOf(after.slice(0, after.length - after.trimStart().length), "\n"),
  );

  return breaks === 0 ? " " : "\n".repeat(breaks);
};

const restAround = (before: string, after: string) => {
  const marks = marksAt(after);
  const next = after.slice(marks.length);

  const unemphasised = (words: string) =>
    marks.includes("*") ? words.replace(/\*+$/u, "") : words;

  let head = before;
  let closers = [...marks].filter((ch) => OPENER_OF.has(ch));
  const markdown = /\[(?<label>[^\]]*)\]\($/u.exec(head);

  if (markdown !== null && closers[0] === ")") {
    head = `${unemphasised(head.slice(0, markdown.index))}${markdown.groups?.label ?? ""}`;
    closers = closers.slice(1);
  }

  head = unemphasised(withoutOpenersOf(head, closers));
  const quote = QUOTE_CLOSER_OF.get(head.at(-1) ?? "");

  if (quote !== undefined && (marks.includes(quote) || next.startsWith(quote))) {
    return restAround(head.slice(0, -1), marks.includes(quote) ? next : next.slice(quote.length));
  }

  const left = head.trim();
  const right = next.trim();

  return left === "" || right === "" ? `${left}${right}` : `${left}${seamOf(head, next)}${right}`;
};

export const withoutLink: (text: string, url: string) => string = (text: string, url: string) => {
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

export const linkInText = (text: string) => {
  for (const found of text.matchAll(LINK_IN_TEXT)) {
    const url = linkOf(found[0]);

    if (isWebUrl(url)) {
      return { rest: withoutLink(text, url), url } satisfies { url: string; rest: string } | null;
    }
  }

  return null;
};
