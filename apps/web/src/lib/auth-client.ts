import { createAuthClient } from "better-auth/client";

// no baseURL: the same Worker serves the app and /api/auth/*, so the relative default is right on every host
export const authClient = createAuthClient();

export interface ActiveSession {
  readonly userId: string;
  readonly email: string;
}

export const activeSession = async (): Promise<ActiveSession | null> => {
  const { data } = await authClient.getSession();
  if (data === null) {
    return null;
  }
  return { email: data.user.email, userId: data.user.id };
};

export const authErrorMessage = (error: { message?: string | undefined } | null): string =>
  error?.message ?? "Something went wrong — try again.";
