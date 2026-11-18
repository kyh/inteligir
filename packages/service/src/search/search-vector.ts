// An item's search vector, written as a tsvector literal from the one tokenizer (`./search-query`),
// so the vector, a query and a passage's matches never disagree on a word. Each token is a lexeme at
// its position, weighted by its field, beside its stem as the shadow lexeme `~stem`: a prefix typed
// against stems dies where the suffix begins, so the literal word is what a prefix matches.

import type { DerivedItem } from "@repo/contract/library/derive-item";

import { stemToken, tokenize } from "./search-query";

// the four fields an item ranks by, title first
export type SearchText = DerivedItem["search"] & { readonly body: string };

type Weight = "A" | "B" | "C" | "D";

// the body's lexemes' weight, which a query asks to learn whether the body holds a term
export const BODY_WEIGHT: Weight = "D";

// ts_rank's default weights, {0.1, 0.2, 0.4, 1.0} for D to A, rank them 1 : 2 : 4 : 10
const FIELD_WEIGHTS: readonly (readonly [keyof SearchText, Weight])[] = [
  ["title", "A"],
  ["headings", "B"],
  ["meta", "C"],
  ["body", BODY_WEIGHT],
];

const WEIGHT_RANK: Readonly<Record<Weight, number>> = { A: 3, B: 2, C: 1, D: 0 };

// Postgres stores every later position as its last
const POSITION_MAX = 16_383;
const POSITIONS_PER_LEXEME = 64;
// Postgres refuses a lexeme past 2,046 bytes, failing the whole write; 256 UTF-16 units and the
// shadow's `~` are at most 769
const TOKEN_MAX_UNITS = 256;
// Postgres refuses a vector whose lexemes cost past 1,048,575 bytes, each its UTF-8 rounded up to
// even, plus 2, plus 2 a position; the fields fill it in order, so a long body loses its tail and
// keeps its opening, which the literal tier still reaches past the budget
const VECTOR_BYTES_BUDGET = 1_000_000;

const utf8Bytes = (text: string): number => Buffer.byteLength(text, "utf-8");

// a lexeme as a tsvector or a tsquery literal spells it
export const lexemeLiteral = (lexeme: string): string =>
  `'${lexeme.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;

// each field's tokens in reading order, the fields title first
const weightedTokens = function* weightedTokens(
  text: SearchText,
): Generator<readonly [string, Weight]> {
  for (const [field, weight] of FIELD_WEIGHTS) {
    for (const token of tokenize(text[field])) {
      if (token.length <= TOKEN_MAX_UNITS) {
        yield [token, weight];
      }
    }
  }
};

export const searchVectorOf = (text: SearchText): string => {
  const positions = new Map<string, Map<number, Weight>>();
  const stems = new Map<string, string>();
  let bytes = 0;
  let position = 0;

  // false once a new lexeme no longer fits, which ends the vector
  const place = (lexeme: string, at: number, weight: Weight): boolean => {
    const held = positions.get(lexeme);
    if (held === undefined) {
      const size = utf8Bytes(lexeme);
      const cost = size + (size % 2) + 2 + 2;
      if (bytes + cost > VECTOR_BYTES_BUDGET) {
        return false;
      }
      bytes += cost;
      positions.set(lexeme, new Map([[at, weight]]));
      return true;
    }
    const prior = held.get(at);
    if (prior !== undefined) {
      if (WEIGHT_RANK[weight] > WEIGHT_RANK[prior]) {
        held.set(at, weight);
      }
    } else if (held.size < POSITIONS_PER_LEXEME && bytes + 2 <= VECTOR_BYTES_BUDGET) {
      bytes += 2;
      held.set(at, weight);
    }
    return true;
  };

  // every token is shadowed, not only one whose stem differs: `budget` stems to `budget`, and its
  // shadow is what a search for `budgeting` finds it by
  const stemOf = (token: string): string => {
    const known = stems.get(token);
    if (known !== undefined) {
      return known;
    }
    const stem = stemToken(token);
    stems.set(token, stem);
    return stem;
  };

  for (const [token, weight] of weightedTokens(text)) {
    position = Math.min(position + 1, POSITION_MAX);
    if (!place(token, position, weight) || !place(`~${stemOf(token)}`, position, weight)) {
      break;
    }
  }

  return [...positions]
    .map(([lexeme, held]) => {
      const at = [...held].map(([spot, weight]) =>
        weight === BODY_WEIGHT ? String(spot) : `${String(spot)}${weight}`,
      );
      return `${lexemeLiteral(lexeme)}:${at.join(",")}`;
    })
    .join(" ");
};
