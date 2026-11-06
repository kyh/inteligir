import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { FakeDevice } from "@repo/library-replica/test-support/fake-cell";
import { describe, expect, it } from "vitest";
import type { KeptCredential } from "../credential/credential-codec";
import { createLoginStore } from "./login-store";

const REQUEST = {
  deviceName: "Ada's iPhone",
  email: "ada@example.com",
  password: "a long password",
};

const storeOver = (network: FakeDevice) => {
  const opened: KeptCredential[] = [];
  const store = createLoginStore({
    client: () => network.client,
    keep: async () => {
      await Promise.resolve();
    },
    signedIn: async (kept) => {
      opened.push(kept);
      await Promise.resolve();
    },
  });
  return { opened, store };
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
    expect(opened).toMatchObject([{ email: "ada@example.com" }]);
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
});
