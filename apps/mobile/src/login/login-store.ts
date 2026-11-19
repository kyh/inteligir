import type { SignUpRequest } from "@repo/contract/account/account-schema";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { z } from "zod";
import type { AuthAnswer, PhoneAuth } from "../auth/phone-auth";
import { messageOf } from "../lib/error-message";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";

export type LoginState =
  | { readonly kind: "idle" }
  | { readonly kind: "signing-in" }
  | { readonly kind: "failed"; readonly message: string };

const loginRequestSchema = z.strictObject({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export type LoginRequest = z.input<typeof loginRequestSchema>;

export interface LoginStoreArgs {
  readonly auth: Pick<PhoneAuth, "cookie" | "signIn" | "signOut" | "signUp">;
  readonly signedIn: () => Promise<void>;
}

export interface LoginStore extends ReadableStore<LoginState> {
  readonly login: (request: LoginRequest) => Promise<void>;
  readonly signUp: (request: SignUpRequest) => Promise<void>;
  readonly fail: (message: string) => void;
}

const DID_NOT_WORK = "That didn't work. Check your connection and try again.";
const NOT_A_SIGN_IN = "Check your email and password.";
const NOT_KEPT = "This iPhone couldn't keep your sign-in.";

const saidOf = (answer: Exclude<AuthAnswer, { kind: "signed-in" }>) => {
  if (answer.kind === "unreachable") {
    return DID_NOT_WORK;
  }

  if (answer.status === 401) {
    return NOT_A_SIGN_IN;
  }

  return answer.status >= 500 || answer.message === null ? DID_NOT_WORK : answer.message;
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

    if (answer.kind !== "signed-in") {
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
        state.set({ kind: "failed", message: NOT_A_SIGN_IN });

        return;
      }

      await enter(async () => await args.auth.signIn(asked.data));
    },
    async signUp(request) {
      if (state.get().kind === "signing-in") {
        return;
      }

      await enter(async () => await args.auth.signUp(request));
    },
    subscribe: state.subscribe,
  } satisfies LoginStore;
};
