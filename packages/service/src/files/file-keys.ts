// A key of its own for each use a file's signature serves, drawn from the secret Better Auth signs
// sessions with: a signature made for one use is none for another, and a new secret voids every
// one outstanding.

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { env } from "../env";

export interface Signer {
  readonly sign: (text: string) => string;
  readonly verifies: (text: string, signature: string) => boolean;
}

export const signerFor = (use: string): Signer => {
  let key: Buffer | null = null;
  const keyOf = (): Buffer => {
    const secret = env.BETTER_AUTH_SECRET;
    if (secret === undefined) {
      throw new Error("BETTER_AUTH_SECRET is unset, so no file can be signed");
    }
    key ??= Buffer.from(hkdfSync("sha256", secret, "", use, 32));
    return key;
  };
  const sign = (text: string): string =>
    createHmac("sha256", keyOf()).update(text).digest("base64url");
  return {
    sign,
    verifies: (text, signature) => {
      const expected = Buffer.from(sign(text));
      const given = Buffer.from(signature);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
  };
};
