// rfc 7636, S256 only: a challenge equal to its verifier binds nothing an interceptor could
// not also send. the verifier never leaves this process; only its challenge rides the browser.

import { base64UrlFromBytes } from "@repo/api/cloud/bytes";

// 32 bytes → 43 base64url chars, inside rfc 7636's 43–128 range
const PKCE_VERIFIER_BYTES = 32;

export function generatePkceVerifier(): string {
  return base64UrlFromBytes(crypto.getRandomValues(new Uint8Array(PKCE_VERIFIER_BYTES)));
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
}
