import { describe, expect, it } from "vitest";
import { fakePhoneAuth } from "../test-support/fake-phone-auth";
import type { FakePhoneAuth } from "../test-support/fake-phone-auth";
import { createLoginStore } from "./login-store";

const REQUEST = { email: "ada@example.com", password: "a long password" };
const NEW_ACCOUNT = { ...REQUEST, inviteCode: "INVITE-1", name: "Ada" };

// the sign-in over the suite's auth; `opens` is whether the library opens
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
      { kind: "refused", message: "Invalid email or password", status: 401 } as const,
      "Check your email and password.",
    ],
    [
      { kind: "refused", message: "Too many requests.", status: 429 } as const,
      "Too many requests.",
    ],
    [
      { kind: "refused", message: "internal error", status: 500 } as const,
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
    for (const request of [
      { ...REQUEST, password: "7 chars" },
      { ...REQUEST, email: "ada@" },
    ]) {
      await store.login(request);
      expect(store.get()).toStrictEqual({
        kind: "failed",
        message: "Check your email and password.",
      });
    }
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
    fake.answer({ kind: "refused", message: "That invite code doesn't work.", status: 403 });
    await store.signUp(NEW_ACCOUNT);
    expect(store.get()).toStrictEqual({
      kind: "failed",
      message: "That invite code doesn't work.",
    });
    expect(opened()).toBe(0);
  });
});
