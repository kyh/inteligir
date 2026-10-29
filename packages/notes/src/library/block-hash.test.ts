import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { BLOCK_HASH_RE, blockHash } from "./block-hash";
import { canonicalJson } from "./canonical-json";
import { paragraph } from "../test-support/library-items";

describe("blockHash", () => {
  it("is the first 128 bits of SHA-256 over the block's canonical JSON", () => {
    const block = paragraph("p1", "text");
    const full = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(block))));
    expect(blockHash(block)).toBe(full.slice(0, 32));
    expect(blockHash(block)).toMatch(BLOCK_HASH_RE);
  });

  it("reads the block, never the order its keys were written in", () => {
    expect(blockHash({ children: [{ text: "a" }], id: "p", type: "p" })).toBe(
      blockHash({ id: "p", type: "p", children: [{ text: "a" }] }),
    );
    expect(blockHash(paragraph("p", "a"))).not.toBe(blockHash(paragraph("p", "b")));
  });
});
