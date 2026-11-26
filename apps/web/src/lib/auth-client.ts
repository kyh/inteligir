import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { signInCodeRefusal } from "@repo/contract/account/account-schema";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({ plugins: [emailOTPClient(), oauthProviderClient()] });

export const AUTH_FALLBACK_ERROR = "Something went wrong — try again.";

export const authErrorMessage = (
  error: { code?: string | undefined; message?: string | undefined } | null,
) => signInCodeRefusal(error?.code) ?? error?.message ?? AUTH_FALLBACK_ERROR;

export interface SignedIn {
  readonly email: string;
  readonly name: string;
}

interface SessionUser extends SignedIn {
  readonly id: string;
}

export type SessionState =
  | { readonly kind: "signed-in"; readonly user: SessionUser }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unknown" };

export const activeSession: () => Promise<SessionState> = async () => {
  try {
    const { data, error } = await authClient.getSession();

    if (error !== null) {
      return { kind: error.status === 401 ? "signed-out" : "unknown" } satisfies SessionState;
    }

    if (data === null) {
      return { kind: "signed-out" } satisfies SessionState;
    }

    const { email, id, name } = data.user;

    return { kind: "signed-in", user: { email, id, name } } satisfies SessionState;
  } catch {
    return { kind: "unknown" } satisfies SessionState;
  }
};

export const SESSION_READ_MS = 3_600_000;

export const keepSession = (read: () => Promise<void>) => {
  setInterval(() => {
    void read();
  }, SESSION_READ_MS);
};
