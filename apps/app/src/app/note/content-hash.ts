// sha-256 hex over the UTF-8 bytes of a string — the client half of the
// vault write's compare-and-swap guard; must agree with the server's
// node:crypto hash over the same encoding, and it does: both hash UTF-8.

export async function contentHashHex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
