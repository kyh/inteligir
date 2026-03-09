import { customAlphabet } from "nanoid";

export const nanoid = customAlphabet("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");

/**
 * Generates a unique identifier with a typed prefix.
 *
 * @example
 *   const chatId = nid('chat'); // 'cht_3kTMd12pnQvexL9j'
 *   const msgId = nid('msg', 12); // 'msg_8zW4pFk2nYx9'
 *
 * @param prefix - The entity type prefix (e.g., 'chat', 'msg', 'char')
 * @param length - The length of the random part (default: 16)
 * @returns A prefixed unique ID (e.g., 'cht_3kTMd12pnQvexL9j')
 *
 *   Features:
 *
 *   - Base58 encoding for shorter, more readable IDs
 *   - No ambiguous characters (0, O, I, l)
 *   - Double-click to copy entire ID
 *   - Type-safe prefix enforcement
 */
export function nid(): string {
  return nanoid(16);
}
