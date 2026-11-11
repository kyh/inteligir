// The phone's auth as its suites hold it: the session it keeps, as a relaunch reads it again, what
// the cloud answers a sign-in, a sign-up and a check, and each call made of it.

import type { AuthAnswer, PhoneAuth, SessionCheck } from "../auth/phone-auth";

export const KEPT_SESSION = "better-auth.session_token=kept";

export interface FakePhoneAuth {
  readonly auth: PhoneAuth;
  // the session the Keychain holds, null for none
  readonly held: () => string | null;
  // each call, as `signIn`, `signUp`, `check` or `signOut`
  readonly calls: string[];
  readonly answer: (next: AuthAnswer) => void;
  readonly checks: (next: SessionCheck) => void;
  // the next sign-in's session is not kept, as a Keychain that refused the write keeps none
  readonly keepNothing: () => void;
}

export const fakePhoneAuth = (kept: string | null = null): FakePhoneAuth => {
  let held = kept;
  let answer: AuthAnswer = { kind: "signed-in" };
  let checked: SessionCheck = "live";
  let keeps = true;
  const calls: string[] = [];
  const entered = async (call: string): Promise<AuthAnswer> => {
    calls.push(call);
    if (answer.kind === "signed-in" && keeps) {
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
  };
};
