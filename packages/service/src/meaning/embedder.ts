import { MEANING_DIMENSIONS } from "@repo/db/library-schema";
import { embedMany } from "ai";

import { gatewayReachable } from "../agent/availability";
import { isStopword, stemToken, tokenize } from "../search/search-query";

const GATEWAY_MODEL = "openai/text-embedding-3-small";

export const MEANING_TEXT_MAX = 8000;

const HASH_MODULUS = 4_294_967_291;

const hashOf = (word: string) => {
  let hash = 7;

  for (const unit of word) {
    hash = (hash * 31 + (unit.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }

  return hash;
};

const unit = (vector: number[]) => {
  const length = Math.hypot(...vector);

  return length === 0 ? vector : vector.map((value) => value / length);
};

const hashedEmbedding = (text: string) => {
  const vector = Array.from({ length: MEANING_DIMENSIONS }, () => 0);

  for (const token of tokenize(text)) {
    if (token.length > 2 && !isStopword(token)) {
      const hash = hashOf(stemToken(token));
      const at = hash % MEANING_DIMENSIONS;
      vector[at] = (vector[at] ?? 0) + (Math.floor(hash / MEANING_DIMENSIONS) % 2 === 0 ? 1 : -1);
    }
  }

  return unit(vector);
};

export const embedTexts = async (texts: readonly string[]) => {
  if (texts.length === 0) {
    return [];
  }

  if (!gatewayReachable()) {
    return texts.map(hashedEmbedding);
  }

  const { embeddings } = await embedMany({
    dimensions: MEANING_DIMENSIONS,
    maxRetries: 1,
    model: GATEWAY_MODEL,
    values: texts.map((text) => text.slice(0, MEANING_TEXT_MAX)),
  });

  return embeddings;
};
