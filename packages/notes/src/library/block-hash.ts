// A block's hash: what a write names as the base it was computed from, and the key a revision's
// block versions are kept under. SHA-256 over the block's canonical JSON, in pure JS so the cell's
// synchronous transaction, the page and the phone compute it alike with no platform crypto; cut
// to 128 bits, which keeps a manifest row short and a collision out of reach.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson } from "./canonical-json";
import type { LibraryBlock } from "./library-nodes";

const HASH_HEX_CHARS = 32;

export const BLOCK_HASH_RE = /^[0-9a-f]{32}$/u;

export const blockHash = (block: LibraryBlock): string =>
  bytesToHex(sha256(utf8ToBytes(canonicalJson(block)))).slice(0, HASH_HEX_CHARS);
