import { createAuthClient } from "better-auth/client";

// ---------------------------------------------------------------------------
// The browser's Better Auth client. No `baseURL`: the app is served by the same
// Worker that answers `/api/auth/*`, so the default relative base is correct on
// localhost, on a preview, and in production alike — the same reason the server
// derives its baseURL from the request origin.
//
// The ONLY credential this page holds is the session cookie, and it never reads
// it: `httpOnly` keeps it out of JavaScript.
// ---------------------------------------------------------------------------

export const authClient = createAuthClient();

/** The signed-in user, as the app routes guard on them. */
export type ActiveSession = {
  readonly userId: string;
  readonly email: string;
};

export async function activeSession(): Promise<ActiveSession | null> {
  const { data } = await authClient.getSession();
  if (data === null) return null;
  return { userId: data.user.id, email: data.user.email };
}

/** The message an auth failure should show. Better Auth answers a rejected
 * credential with a `message`; a transport failure has none, so it gets one. */
export function authErrorMessage(error: { message?: string | undefined } | null): string {
  return error?.message ?? "Something went wrong — try again.";
}
