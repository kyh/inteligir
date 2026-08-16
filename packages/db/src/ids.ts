// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { customAlphabet } from "nanoid";

/** Lowercase alphanumerics minus the look-alikes (0/o/O, 1/l/I). */
export const GENERATED_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
export const GENERATED_ID_SUFFIX_LENGTH = 10;

const generateIdSuffix = customAlphabet(GENERATED_ID_ALPHABET, GENERATED_ID_SUFFIX_LENGTH);

/**
 * `<prefix>_<suffix>` ids, e.g. `thr_8kfm2q9xwz`. Entity tables export their
 * own `create<Entity>Id()` wrapper beside their schema so the prefix is
 * declared exactly once.
 */
export function createPrefixedId(prefix: string): string {
  return `${prefix}_${generateIdSuffix()}`;
}
