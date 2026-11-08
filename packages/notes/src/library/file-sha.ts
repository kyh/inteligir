// The sha a block names a file by, which a host computes from the bytes before it builds the
// block: SHA-256 over the whole of them, in pure JS, so the page, the phone and the cell compute it
// alike with no platform crypto.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const fileSha = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));
