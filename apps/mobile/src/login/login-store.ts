import type { SignUpCodeRequest, SignUpRequest } from "@repo/contract/account/account-schema";
import { SIGN_IN_CODE_LENGTH, signInCodeRefusal } from "@repo/contract/account/account-schema";
import { z } from "zod";
import type { AuthAnswer, PhoneAuth } from "../auth/phone-auth";
import { messageOf } from "../lib/error-message";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";

export type LoginState =
  | { readonly kind: "idle" }
  | { readonly kind: "signing-in" }
  | { readonly kind: "failed"; readonly message: string };

const emailSchema = z.string().trim().pipe(z.email());

const loginRequestSchema = z.strictObject({
  code: z.string().trim().length(SIGN_IN_CODE_LENGTH).regex(/^\d+$/u),
  email: emailSchema,
});

type LoginRequest = z.input<typeof loginRequestSchema>;

export interface LoginStoreArgs {
  readonly auth: Pick<
    PhoneAuth,
    "cookie" | "sendSignInCode" | "sendSignUpCode" | "signIn" | "signOut" | "signUp"
  >;
  readonly signedIn: () => Promise<void>;
}

export interface LoginStore extends ReadableStore<LoginState> {
  readonly sendSignInCode: (email: string) => Promise<boolean>;
  readonly sendSignUpCode: (request: SignUpCodeRequest) => Promise<boolean>;
  readonly login: (request: LoginRequest) => Promise<void>;
  readonly signUp: (request: SignUpRequest) => Promise<void>;
  readonly fail: (message: string) => void;
}

const DID_NOT_WORK = "That didn't work. Check your connection and try again.";
const NOT_AN_EMAIL = "Check your email address.";
const NOT_A_CODE = `Enter the ${String(SIGN_IN_CODE_LENGTH)}-digit code from the email.`;
const NOT_KEPT = "This iPhone couldn't keep your sign-in.";

const saidOf = (answer: Exclude<AuthAnswer, { kind: "accepted" }>) => {
  if (answer.kind === "unreachable") {
    return DID_NOT_WORK;
  }

  return (
    signInCodeRefusal(answer.code) ??
    (answer.status >= 500 || answer.message === null ? DID_NOT_WORK : answer.message)
  );
};

export const createLoginStore = (args: LoginStoreArgs) => {
  const state = createExternalStore<LoginState>({ kind: "idle" });

  const failed = async (message: string) => {
    await args.auth.signOut();
    state.set({ kind: "failed", message });
  };

  const enter = async (ask: () => Promise<AuthAnswer>) => {
    state.set({ kind: "signing-in" });
    const answer = await ask();

    if (answer.kind !== "accepted") {
      state.set({ kind: "failed", message: saidOf(answer) });

      return;
    }

    let kept: string | null;

    try {
      kept = await args.auth.cookie();
    } catch (error) {
      await failed(`${NOT_KEPT} ${messageOf(error)}`);

      return;
    }

    if (kept === null) {
      await failed(NOT_KEPT);

      return;
    }

    try {
      await args.signedIn();
      state.set({ kind: "idle" });
    } catch (error) {
      await failed(messageOf(error));
    }
  };

  const send = async (ask: () => Promise<AuthAnswer>) => {
    if (state.get().kind === "signing-in") {
      return false;
    }

    state.set({ kind: "signing-in" });
    const answer = await ask();

    if (answer.kind !== "accepted") {
      state.set({ kind: "failed", message: saidOf(answer) });

      return false;
    }

    state.set({ kind: "idle" });

    return true;
  };

  return {
    fail(message) {
      state.set({ kind: "failed", message });
    },
    get: state.get,
    async login(request) {
      if (state.get().kind === "signing-in") {
        return;
      }

      const asked = loginRequestSchema.safeParse(request);

      if (!asked.success) {
        state.set({
          kind: "failed",
          message: emailSchema.safeParse(request.email).success ? NOT_A_CODE : NOT_AN_EMAIL,
        });

        return;
      }

      await enter(async () => await args.auth.signIn(asked.data));
    },
    async sendSignInCode(email) {
      const asked = emailSchema.safeParse(email);

      if (!asked.success) {
        state.set({ kind: "failed", message: NOT_AN_EMAIL });

        return false;
      }

      return await send(async () => await args.auth.sendSignInCode(asked.data));
    },
    sendSignUpCode: async (request) =>
      await send(async () => await args.auth.sendSignUpCode(request)),
    async signUp(request) {
      if (state.get().kind === "signing-in") {
        return;
      }

      await enter(async () => await args.auth.signUp(request));
    },
    subscribe: state.subscribe,
  } satisfies LoginStore;
};
