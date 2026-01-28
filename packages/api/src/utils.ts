import { customAlphabet } from "nanoid";

export const nanoid = customAlphabet(
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
);

/**
 * Generates a unique identifier (16 chars, base58)
 */
export function nid(): string {
  return nanoid(16);
}

/**
 * Filters out undefined values from an object, returning only defined entries.
 * Useful for building partial update objects for database mutations.
 */
export function filterUndefined<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}
