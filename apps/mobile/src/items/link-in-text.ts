// A web link inside typed or shared text, up to the first space. The punctuation a sentence puts
// after a link is the sentence's, and so is a closing bracket the link never opened: "(see
// https://x.y/z)" saves https://x.y/z, while https://en.wikipedia.org/wiki/Foo_(bar) keeps its
// own. Pure: the item ops and the tests read it.

import { isWebUrl } from "@repo/notes/items/item-url";

const LINK_IN_TEXT = /https?:\/\/[^\s<>"'`]+/iu;
const SENTENCE_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"]);
const OPENER_OF: ReadonlyMap<string, string> = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
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

export const linkInText = (text: string): { url: string; rest: string } | null => {
  const found = LINK_IN_TEXT.exec(text);
  if (found === null) {
    return null;
  }
  const url = linkTail(found[0]);
  if (!isWebUrl(url)) {
    return null;
  }
  // the punctuation after the link goes with it, so the note keeps no stray mark
  const rest = `${text.slice(0, found.index)}${text.slice(found.index + found[0].length)}`.trim();
  return { rest, url };
};
