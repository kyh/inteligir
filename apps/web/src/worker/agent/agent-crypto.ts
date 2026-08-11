// ---------------------------------------------------------------------------
// Everything the agent surface derives from the deployment secret.
//
// Two independent keys, both HKDF-derived from `BETTER_AUTH_SECRET` under
// distinct `info` labels: one seals the user's provider refresh token at rest
// in their Durable Object, one signs the bearer the container presents on
// every report. Deriving beats a second secret because the failure mode of a
// second secret is a deployment that forgot to set it, and a credential store
// that silently falls back is worse than one that cannot start. Deriving beats
// REUSING the secret directly because two purposes sharing one key means a
// signature oracle on one is a decryption oracle on the other.
//
// The refresh token is the only long-lived credential in the system, and it
// never leaves this Worker: the container receives a placeholder, and the
// interceptor (./egress) puts a short-lived access token on the wire.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CREDENTIAL_INFO = "inteligir/agent/provider-credential/v1";
const REPORT_INFO = "inteligir/agent/report-token/v1";

/** AES-GCM nonce length, in bytes — the size the spec is defined for. */
const NONCE_BYTES = 12;

async function hkdf(secret: string, info: string, salt: string): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(salt), info: encoder.encode(info) },
    material,
    256,
  );
}

/** The per-user key that seals that user's provider credentials. Salted with
 * the user id so one user's sealed blob cannot be replayed into another's
 * object even by someone who can write Durable Object storage. */
async function credentialKey(secret: string, userId: string): Promise<CryptoKey> {
  const bits = await hkdf(secret, CREDENTIAL_INFO, userId);
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function reportKey(secret: string): Promise<CryptoKey> {
  const bits = await hkdf(secret, REPORT_INFO, "report");
  return crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Seal `plaintext` for `userId`. The nonce rides in front of the ciphertext,
 * so the stored value is one opaque string with nothing to lose track of. */
export async function sealCredential(
  secret: string,
  userId: string,
  plaintext: string,
): Promise<string> {
  const key = await credentialKey(secret, userId);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    encoder.encode(plaintext),
  );
  const packed = new Uint8Array(NONCE_BYTES + sealed.byteLength);
  packed.set(nonce, 0);
  packed.set(new Uint8Array(sealed), NONCE_BYTES);
  return base64UrlEncode(packed);
}

/** Open a sealed credential, or `null` when it was not sealed by this key —
 * a rotated secret, a corrupted value, or a blob from another user's object.
 * All three mean the same thing to the caller: connect again. */
export async function openCredential(
  secret: string,
  userId: string,
  sealed: string,
): Promise<string | null> {
  const packed = base64UrlDecode(sealed);
  if (packed === null || packed.length <= NONCE_BYTES) return null;
  try {
    const key = await credentialKey(secret, userId);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.subarray(0, NONCE_BYTES) },
      key,
      packed.subarray(NONCE_BYTES),
    );
    return decoder.decode(plaintext);
  } catch {
    return null;
  }
}

/** What a signed agent token proves. `scope` is part of the signed payload, so
 * a token minted for one purpose is refused by the other's check rather than
 * quietly accepted — one primitive, two uses, no cross-use. */
export type ScopedToken = {
  /** The scope this token was minted under: the container's report bearer, or
   * an OAuth `state` nonce. */
  readonly scope: "report" | "oauth";
  readonly userId: string;
  /** What the token is bound to WITHIN its scope: the container boot for a
   * report bearer, the pending-authorization nonce for an OAuth state. Either
   * way it is what makes the token stop meaning anything once that thing is
   * gone. */
  readonly ref: string;
  readonly expiresAt: number;
};

/**
 * Mint a signed, self-describing token.
 *
 * Stateless by design: the Worker route that receives a report — or an OAuth
 * callback — has to know WHICH object to forward it to before any object has
 * been woken, so the identity must be readable from the token itself. The
 * object still re-verifies the signature and binds it to its own name: the
 * Worker addresses, the object verifies, exactly as the socket and asset routes
 * do.
 */
export async function mintScopedToken(secret: string, claims: ScopedToken): Promise<string> {
  const payload = base64UrlEncode(
    encoder.encode(
      JSON.stringify({ s: claims.scope, u: claims.userId, r: claims.ref, e: claims.expiresAt }),
    ),
  );
  const key = await reportKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** The claims this deployment's signature vouches for under `scope`, expiry
 * aside — the half both public checks share, so neither can verify differently
 * from the other. */
async function signedClaims(
  secret: string,
  scope: ScopedToken["scope"],
  token: string,
): Promise<ScopedToken | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = base64UrlDecode(token.slice(dot + 1));
  if (signature === null) return null;
  const key = await reportKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(payload));
  if (!valid) return null;
  const claims = readClaims(payload);
  return claims === null || claims.scope !== scope ? null : claims;
}

/**
 * The claims a token proves under `scope`, or `null` to refuse.
 *
 * `now` is injected so expiry is testable without a clock stub, and because the
 * one caller that must not trust the token's own sense of time is the one
 * checking it.
 */
export async function verifyScopedToken(
  secret: string,
  scope: ScopedToken["scope"],
  token: string,
  now: number,
): Promise<ScopedToken | null> {
  const claims = await signedClaims(secret, scope, token);
  return claims === null || claims.expiresAt <= now ? null : claims;
}

/**
 * The userId a token names, admitted only once its SIGNATURE holds — what the
 * Worker addresses an object with.
 *
 * It is still not a verdict. The object re-verifies from scratch and adds
 * everything only it can know: whether the token has expired, and whether its
 * `ref` still names a live container generation or a parked authorization. What
 * this buys is the invariant the addressing split rests on: naming a Durable
 * Object brings one into existence, so the name has to come from something a
 * caller cannot mint. Reading the claims unverified would let anyone spray
 * userIds and leave orphan objects behind, each holding storage, belonging to
 * no account and reachable by no purge path.
 *
 * Expiry is deliberately NOT checked here. It is the object's to answer,
 * because the object is what turns "expired" into words a person reads and
 * clears the state that went with it — and an expired token is authentic, so it
 * names an object that already exists.
 */
export async function verifiedTokenAddress(
  secret: string,
  scope: ScopedToken["scope"],
  token: string,
): Promise<string | null> {
  return (await signedClaims(secret, scope, token))?.userId ?? null;
}

function readClaims(payload: string): ScopedToken | null {
  const bytes = base64UrlDecode(payload);
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record: Record<string, unknown> = { ...parsed };
  const scope = record["s"];
  const userId = record["u"];
  const ref = record["r"];
  const expiresAt = record["e"];
  if (scope !== "report" && scope !== "oauth") return null;
  if (typeof userId !== "string" || userId === "") return null;
  if (typeof ref !== "string" || ref === "") return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { scope, userId, ref, expiresAt };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  let binary: string;
  try {
    binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
