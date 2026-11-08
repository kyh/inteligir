// How the phone signs in, keeps its sign-in and lets it go: Better Auth's own routes, through its
// Expo client in the app (`../lib/app-runtime.ts`), which keeps the session cookie in the Keychain,
// and through a stand-in the scenario suite runs under node. Nothing here names a platform.

import { AUTH_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import type { SignUpRequest } from "@repo/contract/cloud/account/account-schema";

// a refusal carries the cloud's status and the sentence it sent, if any; the sign-in screen
// decides what it says
export type AuthAnswer =
  | { readonly kind: "signed-in" }
  | { readonly kind: "refused"; readonly status: number; readonly message: string | null }
  | { readonly kind: "unreachable" };

// Better Auth's own read of the session, the one read that slides it on
export type SessionCheck = "live" | "ended" | "unknown";

export interface PhoneAuth {
  readonly signIn: (request: {
    readonly email: string;
    readonly password: string;
  }) => Promise<AuthAnswer>;
  // through the invite gate, the one door an account is made by
  readonly signUp: (request: SignUpRequest) => Promise<AuthAnswer>;
  // the kept session as a Cookie header, null when the phone keeps none
  readonly cookie: () => Promise<string | null>;
  readonly check: () => Promise<SessionCheck>;
  // settles once the phone keeps no session, never on the cloud's answer, which an unreachable
  // cloud would hold open; never rejects
  readonly signOut: () => Promise<void>;
}

interface ClientRefusal {
  readonly status: number;
  readonly message?: string | undefined;
}

// what of Better Auth's client the phone calls, each answer as better-fetch shapes it: a refusal
// in `error`, a cloud it could not reach thrown. The Expo client's `getCookie` reads the Keychain,
// and its sign-out clears the Keychain before its request goes.
export interface PhoneAuthClient {
  readonly signIn: {
    readonly email: (body: {
      email: string;
      password: string;
    }) => Promise<{ readonly error: ClientRefusal | null }>;
  };
  readonly $fetch: (
    url: string,
    options: { method: "POST"; body: SignUpRequest },
  ) => Promise<{ readonly error: ClientRefusal | null }>;
  readonly getCookie: () => Promise<string>;
  readonly getSession: () => Promise<{
    readonly data: { readonly session: { readonly id: string } } | null;
    readonly error: ClientRefusal | null;
  }>;
  readonly signOut: (options: {
    fetchOptions: { onRequest: () => void };
  }) => Promise<{ readonly error: ClientRefusal | null }>;
}

const answerOf = async (
  call: () => Promise<{ readonly error: ClientRefusal | null }>,
): Promise<AuthAnswer> => {
  let error: ClientRefusal | null;
  try {
    ({ error } = await call());
  } catch {
    return { kind: "unreachable" };
  }
  return error === null
    ? { kind: "signed-in" }
    : { kind: "refused", message: error.message ?? null, status: error.status };
};

export const phoneAuthOver = (client: PhoneAuthClient, cloudUrl: string): PhoneAuth => ({
  async check() {
    try {
      const { data, error } = await client.getSession();
      if (error !== null) {
        return "unknown";
      }
      return data === null ? "ended" : "live";
    } catch {
      return "unknown";
    }
  },
  async cookie() {
    const held = await client.getCookie();
    return held === "" ? null : held;
  },
  signIn: async ({ email, password }) =>
    await answerOf(async () => await client.signIn.email({ email, password })),
  async signOut() {
    // the request's own hook settles it: the Expo client has cleared the Keychain by then
    // oxlint-disable-next-line promise/avoid-new -- the resolver is handed to that hook, which only a promise can do
    await new Promise<void>((resolve) => {
      const tell = async (): Promise<void> => {
        try {
          await client.signOut({ fetchOptions: { onRequest: resolve } });
        } catch {
          // offline: the session stays listed until Settings ends it or it lapses
        } finally {
          resolve();
        }
      };
      void tell();
    });
  },
  signUp: async (request) =>
    await answerOf(
      async () =>
        await client.$fetch(`${cloudUrl}${AUTH_API_PATHS.signUp}`, {
          body: request,
          method: "POST",
        }),
    ),
});
