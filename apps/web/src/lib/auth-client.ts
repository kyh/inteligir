import { createAuthClient } from "better-auth/client";

// no baseURL: the same Worker serves the app and /api/auth/*, so the relative default is right on every host
export const authClient = createAuthClient();

export const AUTH_FALLBACK_ERROR = "Something went wrong — try again.";

export const authErrorMessage = (error: { message?: string | undefined } | null): string =>
  error?.message ?? AUTH_FALLBACK_ERROR;

// a read that failed is not a read that found no session: sending a signed-in user to sign-in
// over a 429 or a 5xx asks for a password they already gave
export type SessionState =
  | { readonly kind: "signed-in" }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unknown"; readonly message: string };

export const activeSession = async (): Promise<SessionState> => {
  const { data, error } = await authClient.getSession();
  if (error !== null) {
    return { kind: "unknown", message: authErrorMessage(error) };
  }
  if (data === null) {
    return { kind: "signed-out" };
  }
  return { kind: "signed-in" };
};
