// The identity proof, from the side that mints it. What it establishes and
// what it deliberately does not is in the module header; these pin the
// mechanics a client depends on.

import { chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureInstanceSecret,
  INSTANCE_SECRET_FILE_NAME,
  newIdentityChallenge,
  proveIdentity,
  readInstanceSecret,
  verifyIdentityProof,
} from "../instance-identity";
import { makeTempDir } from "./temp-dir";

describe("ensureInstanceSecret", () => {
  it("writes an owner-only file the same process can read back", () => {
    const dataDir = makeTempDir("instance-secret-");
    const secret = ensureInstanceSecret(dataDir);

    expect(secret).toMatch(/^[0-9a-f]{64}$/u);
    expect(readInstanceSecret(dataDir)).toBe(secret);
    // 0600. A world-readable secret is a proof anything on the machine can
    // produce, which is the whole failure this guards.
    expect(statSync(join(dataDir, INSTANCE_SECRET_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  it("mints a FRESH secret per boot, so a captured one dies with its process", () => {
    const dataDir = makeTempDir("instance-secret-");
    expect(ensureInstanceSecret(dataDir)).not.toBe(ensureInstanceSecret(dataDir));
  });

  it("re-applies the mode to a secret inherited from a laxer umask", () => {
    // writeFileSync's `mode` is ignored for a file that already exists, so
    // without the explicit chmod a once-loose file would stay loose forever.
    const dataDir = makeTempDir("instance-secret-");
    ensureInstanceSecret(dataDir);
    const path = join(dataDir, INSTANCE_SECRET_FILE_NAME);
    chmodSync(path, 0o644);
    ensureInstanceSecret(dataDir);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("readInstanceSecret", () => {
  it("is null when nothing has booted against the directory", () => {
    expect(readInstanceSecret(makeTempDir("instance-secret-"))).toBeNull();
  });
});

describe("proveIdentity / verifyIdentityProof", () => {
  const secret = "f".repeat(64);

  it("accepts the answer computed from the same secret and challenge", () => {
    const challenge = newIdentityChallenge();
    expect(verifyIdentityProof(secret, challenge, proveIdentity(secret, challenge))).toBe(true);
  });

  it("refuses an answer for a different challenge — a captured proof is worthless", () => {
    const proof = proveIdentity(secret, newIdentityChallenge());
    expect(verifyIdentityProof(secret, newIdentityChallenge(), proof)).toBe(false);
  });

  it("refuses an answer computed from a different secret", () => {
    const challenge = newIdentityChallenge();
    expect(verifyIdentityProof(secret, challenge, proveIdentity("0".repeat(64), challenge))).toBe(
      false,
    );
  });

  it.each(["", "short", "z".repeat(64), "a".repeat(128)])(
    "refuses the malformed proof %o without throwing",
    (proof) => {
      expect(verifyIdentityProof(secret, newIdentityChallenge(), proof)).toBe(false);
    },
  );
});

describe("newIdentityChallenge", () => {
  it("is 32 bytes of hex and never repeats", () => {
    const seen = new Set(Array.from({ length: 64 }, () => newIdentityChallenge()));
    expect(seen.size).toBe(64);
    for (const challenge of seen) {
      expect(challenge).toMatch(/^[0-9a-f]{64}$/u);
    }
  });
});
