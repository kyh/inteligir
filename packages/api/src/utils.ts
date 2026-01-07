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
