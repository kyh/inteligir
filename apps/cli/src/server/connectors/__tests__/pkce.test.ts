import { describe, expect, it } from "vitest";
import { generatePkceVerifier, pkceChallengeS256 } from "../pkce";

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/u;

describe("PKCE (S256)", () => {
  it("generates a fresh verifier in the base64url shape a provider expects", () => {
    const verifier = generatePkceVerifier();
    expect(verifier).toMatch(BASE64URL_43);
    expect(generatePkceVerifier()).not.toBe(verifier);
  });

  it("matches RFC 7636's own S256 test vector", async () => {
    // rfc 7636 appendix b
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceChallengeS256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(await pkceChallengeS256(generatePkceVerifier())).toMatch(BASE64URL_43);
  });
});
