// Byte-level primitives every consumer of the cloud wire spells the same way:
// the Worker hashing a credential, the CLI and the phone minting a pairing
// state, the local contract hashing note content. Web-crypto globals only —
// this leaf loads on workerd, node, the browser and Hermes.

/** Byte array → lowercase hex — the shape of a pairing `state`
 *  (`PAIR_STATE_PATTERN`), a stored credential hash and a content hash. */
export function hexFromBytes(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** `SHA-256(utf8(value))` as lowercase hex — how the Worker stores a device
 *  credential, so both ends of that compare use one spelling. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hexFromBytes(new Uint8Array(digest));
}

/**
 * A length-independent, content-independent-timing equality on two strings.
 *
 * Every caller compares a value a counterparty is guessing at (a pairing
 * state, a PKCE challenge), so equality is compared the way a secret is —
 * and it is spelled by hand because two of the platforms this leaf serves
 * have nothing to call: workerd carries no `crypto.timingSafeEqual` (that is
 * node's) and React Native carries no `node:crypto` at all. The length
 * difference folds into the accumulator and the loop runs the longer
 * string's length whatever the inputs are, so the guard does not depend on
 * both operands being fixed-width.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
