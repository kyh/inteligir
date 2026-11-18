import { hkdfSync } from "node:crypto";

import { env } from "../env";

// each purpose its own key off the auth secret, so a key that leaks reveals nothing of another
export const deriveSecret = (purpose: string): Buffer => {
  const root = env.BETTER_AUTH_SECRET;
  if (root === undefined) {
    throw new Error(`BETTER_AUTH_SECRET is not set, so no "${purpose}" secret can be derived.`);
  }
  return Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), `inteligir/${purpose}/v1`, 32));
};
