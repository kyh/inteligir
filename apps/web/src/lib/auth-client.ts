import { createAuthClient } from "better-auth/client";

// no baseURL: the same Worker serves the app and /api/auth/*, so the relative default is right on every host
export const authClient = createAuthClient();

export type ActiveSession = {
  readonly userId: string;
  readonly email: string;
};

export async function activeSession(): Promise<ActiveSession | null> {
  const { data } = await authClient.getSession();
  if (data === null) return null;
  return { userId: data.user.id, email: data.user.email };
}

export function authErrorMessage(error: { message?: string | undefined } | null): string {
  return error?.message ?? "Something went wrong — try again.";
}
