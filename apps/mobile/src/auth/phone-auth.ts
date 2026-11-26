import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import type { SignUpCodeRequest, SignUpRequest } from "@repo/contract/account/account-schema";

export type AuthAnswer =
  | { readonly kind: "accepted" }
  | {
      readonly kind: "refused";
      readonly status: number;
      readonly code: string | null;
      readonly message: string | null;
    }
  | { readonly kind: "unreachable" };

export type SessionCheck = "live" | "ended" | "unknown";

export interface PhoneAuth {
  readonly sendSignInCode: (email: string) => Promise<AuthAnswer>;
  readonly sendSignUpCode: (request: SignUpCodeRequest) => Promise<AuthAnswer>;
  readonly signIn: (request: {
    readonly email: string;
    readonly code: string;
  }) => Promise<AuthAnswer>;
  readonly signUp: (request: SignUpRequest) => Promise<AuthAnswer>;
  readonly cookie: () => Promise<string | null>;
  readonly check: () => Promise<SessionCheck>;
  readonly signOut: () => Promise<void>;
}

interface ClientRefusal {
  readonly status: number;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

type ClientAnswer = Promise<{ readonly error: ClientRefusal | null }>;

export interface PhoneAuthClient {
  readonly emailOtp: {
    readonly sendVerificationOtp: (body: { email: string; type: "sign-in" }) => ClientAnswer;
  };
  readonly signIn: {
    readonly emailOtp: (body: { email: string; otp: string }) => ClientAnswer;
  };
  readonly $fetch: (
    url: string,
    options: { method: "POST"; body: SignUpCodeRequest | SignUpRequest },
  ) => ClientAnswer;
  readonly getCookie: () => Promise<string>;
  readonly getSession: () => Promise<{
    readonly data: { readonly session: { readonly id: string } } | null;
    readonly error: ClientRefusal | null;
  }>;
  readonly signOut: (options: { fetchOptions: { onRequest: () => void } }) => ClientAnswer;
}

const answerOf = async (call: () => ClientAnswer) => {
  let error: ClientRefusal | null;

  try {
    ({ error } = await call());
  } catch {
    return { kind: "unreachable" } satisfies AuthAnswer;
  }

  return (
    error === null
      ? { kind: "accepted" }
      : {
          code: error.code ?? null,
          kind: "refused",
          message: error.message ?? null,
          status: error.status,
        }
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
    sendSignInCode: async (email) =>
      await answerOf(
        async () => await client.emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
      ),
    sendSignUpCode: async (request) =>
      await answerOf(
        async () =>
          await client.$fetch(`${cloudUrl}${AUTH_API_PATHS.signUpCode}`, {
            body: request,
            method: "POST",
          }),
      ),
    signIn: async ({ code, email }) =>
      await answerOf(async () => await client.signIn.emailOtp({ email, otp: code })),
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
