import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const fileSha = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
