// The documents and quotes the placement properties run over: the editor's canonical round-trip
// fixtures, every construct of the dialect among them, and quotes drawn from the text a person
// reads in each, at a seeded random.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { projectPassages } from "../passage-text";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../../../../../../packages/editor/src/__tests__/fixtures/roundtrip/canonical",
);

export interface CorpusDoc {
  name: string;
  content: string;
}

export const canonicalCorpus = (): CorpusDoc[] =>
  readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".md"))
    .toSorted()
    .map((name) => ({ content: readFileSync(path.join(FIXTURES, name), "utf-8"), name }));

// Park–Miller: the same quotes on every run, in arithmetic that stays inside a safe integer
export const seededRandom = (seed: number): (() => number) => {
  const modulus = 2_147_483_647;
  let state = (Math.abs(Math.trunc(seed)) % (modulus - 1)) + 1;
  return () => {
    state = (state * 48_271) % modulus;
    return (state - 1) / (modulus - 1);
  };
};

// runs of one to six words of the text a person reads, from random starts, some across blocks
export const quotesOf = (content: string, random: () => number, count: number): string[] => {
  const words = projectPassages(content)
    .text.split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) {
    return [];
  }
  const quotes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(random() * words.length);
    const length = 1 + Math.floor(random() * 6);
    quotes.push(words.slice(start, start + length).join(" "));
  }
  return quotes;
};
