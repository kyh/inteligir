import { createAuthClient } from "better-auth/client";

// ---------------------------------------------------------------------------
// The browser's Better Auth client. No `baseURL`: the app is served by the same
// Worker that answers `/api/auth/*`, so the default relative base is correct on
// localhost, on a preview, and in production alike — the same reason the server
// derives its baseURL from the request origin.
//
// The DURABLE credential is the session cookie Better Auth sets; nothing here
// writes a token to storage the page can read. The socket's first-frame auth
// needs the raw session token, and `getSession()` is where it comes from — held
// in memory for exactly as long as it takes to hand to the transport.
// ---------------------------------------------------------------------------

export const authClient = createAuthClient();

/** The signed-in user and the session token their socket authenticates with,
 * or `null` when nobody is signed in. */
export type ActiveSession = { readonly userId: string; readonly token: string };

export async function activeSession(): Promise<ActiveSession | null> {
  const { data } = await authClient.getSession();
  if (data === null) return null;
  return { userId: data.user.id, token: data.session.token };
}

/** The message an auth failure should show. Better Auth answers a rejected
 * credential with a `message`; a transport failure has none, so it gets one. */
export function authErrorMessage(error: { message?: string | undefined } | null): string {
  return error?.message ?? "Something went wrong — try again.";
}
