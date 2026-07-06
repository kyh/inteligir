// ---------------------------------------------------------------------------
// AUTH SEAM — replace with real auth.
//
// The worker parses the bearer token (`parseBearer`) and calls `authorize` to
// confirm the caller may act on `vaultId`. This is a STUB: it accepts a token
// that equals the vaultId (the token IS the vault id).
//
// To make this real, swap the body of `authorize` for a genuine check — verify
// a signed session / API token and confirm its owner has access to `vaultId`
// (e.g. look the token up in KV/D1 and compare its vault claim). That check is
// I/O, hence the async signature; it would also take `env` for the binding.
// Everything else in this Worker is already wired to await it.
// ---------------------------------------------------------------------------

/** Constant-time string equality (avoids a timing side-channel on the token). */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false; // length is not secret
  let diff = 0;
  for (let i = 0; i < ba.length; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * True when `token` is authorized to act on `vaultId`. STUB: token === vaultId.
 * Replace with a real token->owner->vault check (see the module header).
 */
export async function authorize(token: string, vaultId: string): Promise<boolean> {
  return constantTimeEqual(token, vaultId);
}
