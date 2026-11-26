import type { AuthAnswer, PhoneAuth, SessionCheck } from "../auth/phone-auth";

export const KEPT_SESSION = "better-auth.session_token=kept";

export interface FakePhoneAuth {
  readonly auth: PhoneAuth;
  readonly held: () => string | null;
  readonly calls: string[];
  readonly answer: (next: AuthAnswer) => void;
  readonly checks: (next: SessionCheck) => void;
  readonly keepNothing: () => void;
}

export const fakePhoneAuth = (kept: string | null = null) => {
  let held = kept;
  let answer: AuthAnswer = { kind: "accepted" };
  let checked: SessionCheck = "live";
  let keeps = true;
  const calls: string[] = [];

  const entered = async (call: string) => {
    calls.push(call);

    if (answer.kind === "accepted" && keeps) {
      held = KEPT_SESSION;
    }

    return await Promise.resolve(answer);
  };

  return {
    answer: (next) => {
      answer = next;
    },
    auth: {
      check: async () => {
        calls.push("check");

        return await Promise.resolve(checked);
      },
      cookie: async () => await Promise.resolve(held),
      sendSignInCode: async () => {
        calls.push("sendSignInCode");

        return await Promise.resolve(answer);
      },
      sendSignUpCode: async () => {
        calls.push("sendSignUpCode");

        return await Promise.resolve(answer);
      },
      signIn: async () => await entered("signIn"),
      signOut: async () => {
        calls.push("signOut");
        held = null;
        await Promise.resolve();
      },
      signUp: async () => await entered("signUp"),
    },
    calls,
    checks: (next) => {
      checked = next;
    },
    held: () => held,
    keepNothing: () => {
      keeps = false;
    },
  } satisfies FakePhoneAuth;
};
