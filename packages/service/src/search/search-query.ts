// The one tokenizer: an item's search vector, a query's terms and a passage's matches are all cut
// by it, so none of them can disagree on what a word is.

import { stemmer } from "stemmer";

// marks folded away, so `acción` and `accion` are one word wherever they are written
const foldDiacritics = (text: string): string => text.normalize("NFD").replaceAll(/\p{Mn}+/gu, "");

export const tokenize = (text: string): string[] =>
  foldDiacritics(text.toLowerCase()).match(/[\p{L}\p{N}_]+/gu) ?? [];

// `stemmer` is imported here and nowhere else, so the vector's stems and a query's cannot diverge
export const stemToken = (token: string): string => stemmer(token);
