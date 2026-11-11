import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { contentHash } from "./content-hash";

describe(contentHash, () => {
  it("is the first 128 bits of SHA-256 over the text's UTF-8", () => {
    const text = "a heading · ünïcode";
    const full = bytesToHex(sha256(new TextEncoder().encode(text)));
    expect(contentHash(text)).toBe(full.slice(0, 32));
  });
});
