import { PKCE_S256_PATTERN, pkceChallengeS256 } from "@repo/api/cloud/pairing/pairing-schema";
import { describe, expect, it } from "vitest";
import { base64UrlFromBytes, createPkcePair, hexFromBytes, type PkceCrypto } from "../pkce";

/** The contract states its own transform runs on Node's web crypto; the mobile
 *  assembly injects the primitives, so the suite injects Node's here and PINS the
 *  result against the contract. */
const nodeCrypto: PkceCrypto = {
  randomBytes: (length) => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  },
  sha256: async (input) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))),
};

describe("PKCE on the phone", () => {
  it("produces a verifier and an S256 challenge the contract admits", async () => {
    const pair = await createPkcePair(nodeCrypto);
    expect(pair.verifier).toMatch(PKCE_S256_PATTERN);
    expect(pair.challenge).toMatch(PKCE_S256_PATTERN);
  });

  it("computes the SAME challenge as the contract's own transform", async () => {
    const pair = await createPkcePair(nodeCrypto);
    // If this drifts, an intercepted code becomes spendable — the mobile and
    // cloud spellings of `S256(verifier)` MUST agree.
    expect(pair.challenge).toBe(await pkceChallengeS256(pair.verifier));
  });

  it("encodes bytes to base64url and hex the way the contract's patterns expect", () => {
    expect(base64UrlFromBytes(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe("-_-_");
    expect(hexFromBytes(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });
});
