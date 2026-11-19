import type { DerivedItem } from "@repo/contract/library/derive-item";

import { stemToken, tokenize } from "./search-query";

export type SearchText = DerivedItem["search"] & { readonly body: string };

type Weight = "A" | "B" | "C" | "D";

export const BODY_WEIGHT: Weight = "D";

const FIELD_WEIGHTS: readonly (readonly [keyof SearchText, Weight])[] = [
  ["title", "A"],
  ["headings", "B"],
  ["meta", "C"],
  ["body", BODY_WEIGHT],
];

const WEIGHT_RANK: Readonly<Record<Weight, number>> = { A: 3, B: 2, C: 1, D: 0 };

const POSITION_MAX = 16_383;
const POSITIONS_PER_LEXEME = 64;
const TOKEN_MAX_UNITS = 256;
const VECTOR_BYTES_BUDGET = 1_000_000;

const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf-8");

export const lexemeLiteral = (lexeme: string) =>
  `'${lexeme.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;

const weightedTokens: (text: SearchText) => Generator<readonly [string, Weight]> =
  function* weightedTokens(text: SearchText) {
    for (const [field, weight] of FIELD_WEIGHTS) {
      for (const token of tokenize(text[field])) {
        if (token.length <= TOKEN_MAX_UNITS) {
          yield [token, weight];
        }
      }
    }
  };

export const searchVectorOf = (text: SearchText) => {
  const positions = new Map<string, Map<number, Weight>>();
  const stems = new Map<string, string>();
  let bytes = 0;
  let position = 0;

  const place = (lexeme: string, at: number, weight: Weight) => {
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

  const stemOf = (token: string) => {
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
