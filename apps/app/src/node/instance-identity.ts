// WHO IS ANSWERING ON THIS PORT?
//
// "Something returned 200 on /api/v1/health" is not an answer. Loopback ports
// are first-come-first-served and unauthenticated, so any local process can
// hold 4664 before the real server does — and a client that adopts it hands a
// stranger the trusted window, the origin's storage, and every request the
// user's UI is about to make. The desktop shell adopts a running server on
// purpose (a user with `npx inteligir` open should get a window on the vault
// they are already using), which is exactly why adoption has to be earned.
//
// THE PROOF IS ACCESS TO THE DATA DIR. Every boot mints a secret into
// `<dataDir>/instance-secret` at 0600, and the server answers a challenge with
// an HMAC over it. A client that knows which data dir it means reads the same
// file and checks the answer. A responder that cannot read that directory
// cannot produce the HMAC, so it wins nothing by squatting the port.
//
// WHAT THIS IS NOT: it is not proof that the responder is THIS code. A process
// running as the same user can read the file, and no file mode can prevent
// that. The bound is honest and it is the one that matters here — it separates
// "a program that owns this vault's data directory" from "a program that got
// to a port first", which is the whole of the adoption question.
//
// CHALLENGE-RESPONSE, not a bearer token: the secret itself is never sent, so
// asking the server nicely does not hand out the credential, and a captured
// proof is worth nothing against the next challenge.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errnoCode } from "./errno";

export const INSTANCE_SECRET_FILE_NAME = "instance-secret";

/** 256 bits, hex-encoded. Large enough that the file is the only way to it. */
const SECRET_BYTES = 32;
const CHALLENGE_BYTES = 32;

/** Owner read/write. The mode is applied on every write, not only on create:
 *  `writeFileSync`'s `mode` is ignored for a file that already exists, so a
 *  secret inherited from a laxer umask would keep it forever. */
const SECRET_FILE_MODE = 0o600;

function secretPath(dataDir: string): string {
  return join(dataDir, INSTANCE_SECRET_FILE_NAME);
}

/**
 * Mint this boot's secret and write it to the data dir. Per BOOT rather than
 * per install: a secret that outlives its process is a credential someone can
 * replay against the next one, and there is nothing to gain by persisting it —
 * every reader takes it from the file, which is rewritten before the listener
 * opens.
 */
export function ensureInstanceSecret(dataDir: string): string {
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  const path = secretPath(dataDir);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, `${secret}\n`, { encoding: "utf8", mode: SECRET_FILE_MODE });
  chmodSync(path, SECRET_FILE_MODE);
  return secret;
}

/** The secret a data dir currently holds, or null when there is none to read —
 *  no server has booted against it, or this process may not read it. */
export function readInstanceSecret(dataDir: string): string | null {
  try {
    const raw = readFileSync(secretPath(dataDir), "utf8").trim();
    return raw.length === 0 ? null : raw;
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "EACCES") {
      return null;
    }
    throw error;
  }
}

/** A fresh challenge for one verification. Never reused: the point of asking is
 *  that last answer proves nothing about this one. */
export function newIdentityChallenge(): string {
  return randomBytes(CHALLENGE_BYTES).toString("hex");
}

/** The answer only a holder of `secret` can compute. */
export function proveIdentity(secret: string, challenge: string): string {
  return createHmac("sha256", secret).update(challenge).digest("hex");
}

/** Constant-time comparison — a length-or-content compare leaks the proof one
 *  byte at a time to a caller that can time it. */
export function verifyIdentityProof(secret: string, challenge: string, proof: string): boolean {
  const expected = Buffer.from(proveIdentity(secret, challenge), "utf8");
  const actual = Buffer.from(proof, "utf8");
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
