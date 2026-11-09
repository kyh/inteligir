// Any stored text's hash: SHA-256 in pure JS, so the cell's synchronous transaction, the page and
// the phone compute it alike with no platform crypto, cut to 128 bits, which keeps a key short and
// a collision out of reach. The cell keys the parts of a change set by it, so two sets that share a
// part store it once, and a block's hash and a folded heading's key are it too.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const HASH_HEX_CHARS = 32;

export const contentHash = (text: string): string =>
  bytesToHex(sha256(utf8ToBytes(text))).slice(0, HASH_HEX_CHARS);
