// Better Auth's own client, on the origin that served the page: the session the site's sign-in left
// is Better Auth's, so its end is too. `/api/auth/sign-out` deletes the row, which closes its
// sockets, and clears the cookie, which nothing of the page's own could.

import type { V1Transport } from "@repo/contract/cloud/library/call-outcome";
import { createAuthClient } from "better-auth/client";

export const createPageAuth = (cloud: V1Transport) => {
  const client = createAuthClient({
    // named, never left to Better Auth's guess, which reads the environment before the page's origin
    baseURL: cloud.origin,
    fetchOptions: {
      customFetchImpl: async (input, init) => await cloud.fetch(new Request(input, init)),
    },
  });
  return {
    // a refusal or no answer rejects, so the page stays signed in and says so
    signOut: async (): Promise<void> => {
      await client.signOut({ fetchOptions: { throw: true } });
    },
  };
};

export type PageAuth = ReturnType<typeof createPageAuth>;
