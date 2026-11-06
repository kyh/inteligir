// Seeded text of every kind a conversation carries, each piece with the most tokens Claude may bill
// it as: English words at the 1.3 tokens Opus 4.7's tokenizer spends where earlier ones spent one
// on 3.5 English characters (platform.claude.com/docs/en/about-claude/glossary), and the rest at
// what Claude's published tokenizer (`@anthropic-ai/tokenizer`, Claude 2's) was measured to spend
// a character on each kind, a third again for the newer one: a sha 0.78, a uuid 0.89, base64
// 0.95, digits 0.57, CJK and Hangul 1.3, an emoji 1.93 a UTF-16 unit. A space between pieces is
// counted at half a token.

import { pick } from "@repo/notes/test-support/seeded-random";

// what a piece of text is billed at most, a token a character
const RATIOS = {
  base64: 0.95,
  cjk: 1.3,
  digits: 0.57,
  emoji: 1.93,
  english: 1.3 / 3.5,
  hangul: 1.3,
  hex: 0.78,
  uuid: 0.89,
} as const;

type Kind = keyof typeof RATIOS;

const KINDS: readonly Kind[] = [
  "base64",
  "cjk",
  "digits",
  "emoji",
  "english",
  "hangul",
  "hex",
  "uuid",
];

const WORDS = [
  "a",
  "the",
  "library",
  "note",
  "saved",
  "article",
  "reading",
  "highlight",
  "folder",
  "agent",
  "tidy",
  "unsorted",
  "conversation",
  "summarize",
  "everything",
  "knowledge",
] as const;

const HEX = "0123456789abcdef";
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const between = (rand: () => number, low: number, high: number): number =>
  low + Math.floor(rand() * (high - low + 1));

const drawn = (rand: () => number, alphabet: string, length: number): string =>
  Array.from({ length }, () => pick(rand, [...alphabet])).join("");

const codePoints = (rand: () => number, low: number, high: number, length: number): string =>
  Array.from({ length }, () => String.fromCodePoint(between(rand, low, high))).join("");

const pieceOf = (rand: () => number, kind: Kind): string => {
  switch (kind) {
    case "english": {
      return Array.from({ length: between(rand, 1, 12) }, () => pick(rand, WORDS)).join(" ");
    }
    case "hex": {
      return drawn(rand, HEX, pick(rand, [40, 64]));
    }
    case "uuid": {
      return [8, 4, 4, 4, 12].map((length) => drawn(rand, HEX, length)).join("-");
    }
    case "base64": {
      return `${drawn(rand, BASE64, 4 * between(rand, 16, 256))}==`;
    }
    case "digits": {
      return drawn(rand, "0123456789", between(rand, 1, 13));
    }
    case "cjk": {
      return codePoints(rand, 0x4e_00, 0x9f_ff, between(rand, 1, 40));
    }
    case "hangul": {
      return codePoints(rand, 0xac_00, 0xd7_a3, between(rand, 1, 40));
    }
    case "emoji": {
      return codePoints(rand, 0x1_f3_00, 0x1_fa_ff, between(rand, 1, 8));
    }
    // no default
  }
};

interface BilledText {
  readonly text: string;
  // the most tokens Claude may bill `text` as
  readonly tokens: number;
}

// pieces of every kind drawn until the text may be billed `tokens` at least
export const textOf = (rand: () => number, tokens: number): BilledText => {
  const pieces: string[] = [];
  let billed = 0;
  while (billed < tokens) {
    const kind = pick(rand, KINDS);
    const piece = pieceOf(rand, kind);
    // the space before it, after the first
    billed += RATIOS[kind] * piece.length + (pieces.length === 0 ? 0 : 0.5);
    pieces.push(piece);
  }
  return { text: pieces.join(" "), tokens: Math.ceil(billed) };
};
