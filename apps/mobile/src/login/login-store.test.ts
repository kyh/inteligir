import { describe, expect, it } from "vitest";
import { fakePhoneAuth } from "../test-support/fake-phone-auth.test-utils";
import type { FakePhoneAuth } from "../test-support/fake-phone-auth.test-utils";
import { createLoginStore } from "./login-store";

const REQUEST = { code: "123456", email: "ada@example.com" };
const NEW_ACCOUNT = { ...REQUEST, inviteCode: "INVITE-1", name: "Ada" };

const storeOver = (fake: FakePhoneAuth, opens = true) => {
  let opened = 0;

  const store = createLoginStore({
    auth: fake.auth,
    signedIn: async () => {
      if (!opens) {
        throw new Error("The library on this iPhone couldn't be opened.");
      }

      opened += 1;
      await Promise.resolve();
    },
  });

  return { opened: () => opened, store };
};

describe("the phone's sign-in", () => {
  it("is one sign-in however often it is tapped while it runs", async () => {
    const fake = fakePhoneAuth();
    const { opened, store } = storeOver(fake);
    const first = store.login(REQUEST);
    expect(store.get()).toStrictEqual({ kind: "signing-in" });
    await store.login(REQUEST);
    await first;

    expect(fake.calls).toStrictEqual(["signIn"]);
    expect(opened()).toBe(1);
    expect(store.get()).toStrictEqual({ kind: "idle" });
  });

  it.each([
    [
      { code: "INVALID_OTP", kind: "refused", message: "Invalid OTP", status: 400 } as const,
      "That code didn't work. Check it, or send a new one.",
    ],
    [
      { code: "OTP_EXPIRED", kind: "refused", message: "OTP expired", status: 400 } as const,
      "That code has expired. Send a new one.",
    ],
    [
      { code: null, kind: "refused", message: "Too many requests.", status: 429 } as const,
      "Too many requests.",
    ],
    [
      { code: null, kind: "refused", message: "internal error", status: 500 } as const,
      "That didn't work. Check your connection and try again.",
    ],
    [{ kind: "unreachable" } as const, "That didn't work. Check your connection and try again."],
  ])("says %j as %s, and opens nothing", async (answer, said) => {
    const fake = fakePhoneAuth();
    const { opened, store } = storeOver(fake);
    fake.answer(answer);
    await store.login(REQUEST);
    expect(store.get()).toStrictEqual({ kind: "failed", message: said });
    expect(opened()).toBe(0);
  });

  it("says a request the cloud would refuse in its own words, and sends nothing", async () => {
    const fake = fakePhoneAuth();
    const { store } = storeOver(fake);

    for (const [request, said] of [
      [{ ...REQUEST, code: "12345" }, "Enter the 6-digit code from the email."],
      [{ ...REQUEST, code: "12345a" }, "Enter the 6-digit code from the email."],
      [{ ...REQUEST, email: "ada@" }, "Check your email address."],
    ] as const) {
      await store.login(request);
      expect(store.get()).toStrictEqual({ kind: "failed", message: said });
    }

    await expect(store.sendSignInCode("ada@")).resolves.toBe(false);
    expect(store.get()).toStrictEqual({ kind: "failed", message: "Check your email address." });
    expect(fake.calls).toStrictEqual([]);
  });

  it("signs out again when the Keychain kept no session, so none is held that cannot be used", async () => {
    const fake = fakePhoneAuth();
    fake.keepNothing();
    const { opened, store } = storeOver(fake);
    await store.login(REQUEST);
    expect(store.get()).toStrictEqual({
      kind: "failed",
      message: "This iPhone couldn't keep your sign-in.",
    });
    expect(fake.calls).toStrictEqual(["signIn", "signOut"]);
    expect(opened()).toBe(0);
  });

  it("signs out again when the library does not open under it", async () => {
    const fake = fakePhoneAuth();
    const { store } = storeOver(fake, false);
    await store.login(REQUEST);
    expect(store.get()).toStrictEqual({
      kind: "failed",
      message: "The library on this iPhone couldn't be opened.",
    });
    expect(fake.calls).toStrictEqual(["signIn", "signOut"]);
    expect(fake.held()).toBeNull();
  });
});

describe("the phone's sign-in code", () => {
  it("is asked once for the email, and says it went", async () => {
    const fake = fakePhoneAuth();
    const { store } = storeOver(fake);
    const asked = store.sendSignInCode(" ada@example.com ");
    expect(store.get()).toStrictEqual({ kind: "signing-in" });
    await expect(store.sendSignInCode("ada@example.com")).resolves.toBe(false);
    await expect(asked).resolves.toBe(true);
    expect(fake.calls).toStrictEqual(["sendSignInCode"]);
    expect(store.get()).toStrictEqual({ kind: "idle" });
  });

  it("is refused at sign-up in the gate's own sentence", async () => {
    const fake = fakePhoneAuth();
    const { store } = storeOver(fake);
    fake.answer({
      code: null,
      kind: "refused",
      message: "That invite code doesn't work.",
      status: 403,
    });
    await expect(
      store.sendSignUpCode({ email: "ada@example.com", inviteCode: "INVITE-1" }),
    ).resolves.toBe(false);
    expect(store.get()).toStrictEqual({
      kind: "failed",
      message: "That invite code doesn't work.",
    });
    expect(fake.calls).toStrictEqual(["sendSignUpCode"]);
  });
});

describe("the phone's sign-up", () => {
  it("makes the account through the invite gate and opens its library", async () => {
    const fake = fakePhoneAuth();
    const { opened, store } = storeOver(fake);
    await store.signUp(NEW_ACCOUNT);
    expect(fake.calls).toStrictEqual(["signUp"]);
    expect(opened()).toBe(1);
    expect(store.get()).toStrictEqual({ kind: "idle" });
  });

  it("says the gate's refusal in the gate's own sentence", async () => {
    const fake = fakePhoneAuth();
    const { opened, store } = storeOver(fake);
    fake.answer({
      code: null,
      kind: "refused",
      message: "That invite code doesn't work.",
      status: 403,
    });
    await store.signUp(NEW_ACCOUNT);
    expect(store.get()).toStrictEqual({
      kind: "failed",
      message: "That invite code doesn't work.",
    });
    expect(opened()).toBe(0);
  });
});
