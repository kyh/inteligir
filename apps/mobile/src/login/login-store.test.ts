import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeDevice } from "@repo/contract/test-support/fake-cell";
import { describe, expect, it } from "vitest";
import { createLoginStore } from "./login-store";

const REQUEST = {
  deviceName: "Ada's iPhone",
  email: "ada@example.com",
  password: "a long password",
};

// the sign-in over a fake cloud and a Keychain in memory; `opens` is whether the library opens
const storeOver = (network: FakeDevice, opens = true) => {
  const opened: string[] = [];
  // the credential each client was made with, null for none
  const clients: (string | null)[] = [];
  // what the Keychain holds of the sign-in, null once it holds nothing
  interface Keychain {
    kept: string | null;
  }
  const keychain: Keychain = { kept: null };
  const store = createLoginStore({
    client: (credential) => {
      clients.push(credential);
      return network.client;
    },
    forget: async () => {
      keychain.kept = null;
      await Promise.resolve();
    },
    keep: async (kept) => {
      keychain.kept = kept;
      await Promise.resolve();
    },
    signedIn: async (kept) => {
      if (!opens) {
        throw new Error("The library on this iPhone couldn't be opened.");
      }
      opened.push(kept);
      await Promise.resolve();
    },
  });
  return { clients, keychain, opened, store };
};

describe("the phone's sign-in", () => {
  it("is one sign-in however often it is tapped while it runs", async () => {
    const cell = createFakeCell();
    const { opened, store } = storeOver(cell.device("phone"));
    const first = store.login(REQUEST);
    expect(store.get()).toStrictEqual({ kind: "signing-in" });
    await store.login(REQUEST);
    await first;

    expect(cell.calls.filter((call) => call.endsWith("account/signIn"))).toHaveLength(1);
    expect(opened).toHaveLength(1);
    expect(store.get()).toStrictEqual({ kind: "idle" });
  });

  it("says a refusal in the cloud's own sentence, and an unreachable cloud in its own", async () => {
    const cell = createFakeCell();
    const network = cell.device("phone");
    const { opened, store } = storeOver(network);

    cell.signOut();
    await store.login(REQUEST);
    const refused = store.get();
    expect(refused.kind).toBe("failed");
    expect(refused.kind === "failed" ? refused.message : "").not.toMatch(/fetch|network/iu);

    network.setOffline(true);
    await store.login(REQUEST);
    expect(store.get()).toStrictEqual({
      kind: "failed",
      message: "That didn't work. Check your connection and try again.",
    });
    expect(opened).toStrictEqual([]);
  });

  it("says a request the cloud would refuse in its own words, and sends nothing", async () => {
    const cell = createFakeCell();
    const { store } = storeOver(cell.device("phone"));
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
    expect(cell.calls).toStrictEqual([]);
  });

  it("lets the device go, and forgets it, when the library does not open under it", async () => {
    const cell = createFakeCell();
    const { clients, keychain, store } = storeOver(cell.device("phone"), false);
    await store.login(REQUEST);
    expect(store.get()).toStrictEqual({
      kind: "failed",
      message: "The library on this iPhone couldn't be opened.",
    });
    expect(cell.calls.filter((call) => call.endsWith("account/signOut"))).toHaveLength(1);
    // the sign-out went under the credential the sign-in answered
    expect(clients.at(-1)).toMatch(/^igd_/u);
    expect(keychain.kept).toBeNull();
  });
});
