// A PKCE pair (RFC 7636 § 4.1, § 4.2): 32 random bytes as the verifier, and its SHA-256 as the
// S256 challenge, both base64url. The provider refuses a public client's authorization without
// one, so the suites' assistant makes a pair as every assistant does.

import { base64UrlFromBytes } from "@repo/contract/cloud/bytes";

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export const pkcePair = async (): Promise<PkcePair> => {
  const verifier = base64UrlFromBytes(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { challenge: base64UrlFromBytes(new Uint8Array(digest)), verifier };
};
