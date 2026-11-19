import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";

export type AuthAnswer =
  | { readonly kind: "signed-in" }
  | { readonly kind: "refused"; readonly status: number; readonly message: string | null }
  | { readonly kind: "unreachable" };

export type SessionCheck = "live" | "ended" | "unknown";

export interface PhoneAuth {
  readonly signIn: (request: {
    readonly email: string;
    readonly password: string;
  }) => Promise<AuthAnswer>;
  readonly signUp: (request: SignUpRequest) => Promise<AuthAnswer>;
  readonly cookie: () => Promise<string | null>;
  readonly check: () => Promise<SessionCheck>;
  readonly signOut: () => Promise<void>;
}

interface ClientRefusal {
  readonly status: number;
  readonly message?: string | undefined;
}

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

const answerOf = async (call: () => Promise<{ readonly error: ClientRefusal | null }>) => {
  let error: ClientRefusal | null;

  try {
    ({ error } = await call());
  } catch {
    return { kind: "unreachable" } satisfies AuthAnswer;
  }

  return (
    error === null
      ? { kind: "signed-in" }
      : { kind: "refused", message: error.message ?? null, status: error.status }
  ) satisfies AuthAnswer;
};

export const phoneAuthOver = (client: PhoneAuthClient, cloudUrl: string) =>
  ({
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
      // oxlint-disable-next-line promise/avoid-new -- the resolver is handed to that hook, which only a promise can do
      await new Promise<void>((resolve) => {
        const tell = async () => {
          await Promise.allSettled([client.signOut({ fetchOptions: { onRequest: resolve } })]);
          resolve();
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
  }) satisfies PhoneAuth;
