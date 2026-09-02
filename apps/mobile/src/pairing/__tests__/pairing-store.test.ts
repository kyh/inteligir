import type { CloudFetch } from "@repo/api/cloud/client";
import { describe, expect, it } from "vitest";
import { createPairingFlow, type PairCallback } from "@repo/api/cloud/pairing/pairing-flow";
import {
  pairRedirectUrlSchema,
  type DeviceCredential,
} from "@repo/api/cloud/pairing/pairing-schema";
import { createPairingStore, type PairingStore } from "../pairing-store";
import { CALLBACK, fakeCrypto, REDEEMED, redeemOk, redeemRefused, stateOf } from "./fakes";

interface FakeBrowser {
  opened: Promise<string>;
  opens: number;
  comeBack: (callback: PairCallback | null) => void;
  open: (approveUrl: string) => Promise<PairCallback | null>;
}

function fakeBrowser(): FakeBrowser {
  let onOpened: ((approveUrl: string) => void) | null = null;
  let onReturn: ((callback: PairCallback | null) => void) | null = null;
  const browser: FakeBrowser = {
    opened: new Promise((resolve) => {
      onOpened = resolve;
    }),
    opens: 0,
    comeBack: (callback) => onReturn?.(callback),
    open: (approveUrl) => {
      browser.opens += 1;
      onOpened?.(approveUrl);
      return new Promise((resolve) => {
        onReturn = resolve;
      });
    },
  };
  return browser;
}

function approvalOf(approveUrl: string): PairCallback {
  return { code: "ABCD-EFGH", state: stateOf(approveUrl) };
}

interface Harness {
  browser: FakeBrowser;
  paired: DeviceCredential[];
  flow: PairingStore;
}

function harness(args: {
  fetch: CloudFetch;
  onPaired?: (credential: DeviceCredential) => Promise<void>;
}): Harness {
  const browser = fakeBrowser();
  const paired: DeviceCredential[] = [];
  const flow = createPairingStore({
    machine: createPairingFlow({
      cloudUrl: "https://cloud.test",
      crypto: fakeCrypto,
      fetch: args.fetch,
    }),
    redirect: CALLBACK,
    deviceName: "Test Phone",
    openApprove: browser.open,
    onPaired:
      args.onPaired ??
      ((credential) => {
        paired.push(credential);
        return Promise.resolve();
      }),
  });
  return { browser, paired, flow };
}

describe("the callback this app registers", () => {
  it("is a shape the production approve page admits", () => {
    expect(pairRedirectUrlSchema.safeParse(CALLBACK).success).toBe(true);
  });
});

describe("the pairing flow", () => {
  it("is pairing while the browser is open, and idle once the credential is this device's", async () => {
    const { browser, paired, flow } = harness({ fetch: redeemOk });
    expect(flow.get()).toStrictEqual({ kind: "idle" });

    const run = flow.startPair();
    const approveUrl = await browser.opened;
    expect(flow.get()).toStrictEqual({ kind: "pairing" });
    await flow.startPair();
    expect(browser.opens).toBe(1);
    // identity, not equality: a snapshot rebuilt per read loops useSyncExternalStore.
    expect(flow.get()).toBe(flow.get());

    browser.comeBack(approvalOf(approveUrl));
    await run;
    expect(paired).toStrictEqual([REDEEMED]);
    expect(flow.get()).toStrictEqual({ kind: "idle" });
  });

  it("closing the browser cancels: idle, nothing paired, the approval disarmed", async () => {
    const { browser, paired, flow } = harness({ fetch: redeemOk });
    const run = flow.startPair();
    const approveUrl = await browser.opened;
    browser.comeBack(null);
    await run;
    expect(flow.get()).toStrictEqual({ kind: "idle" });
    await flow.complete(approvalOf(approveUrl));
    expect(paired).toHaveLength(0);
    expect(flow.get()).toStrictEqual({ kind: "idle" });
  });

  it("shows a refusal", async () => {
    const { browser, paired, flow } = harness({ fetch: redeemRefused });
    const run = flow.startPair();
    browser.comeBack(approvalOf(await browser.opened));
    await run;
    expect(paired).toHaveLength(0);
    expect(flow.get()).toStrictEqual({ kind: "failed", message: "that code expired" });
  });

  it("publishes the deep-link path's outcome too, and a replayed return is inert", async () => {
    const { browser, paired, flow } = harness({ fetch: redeemOk });
    const run = flow.startPair();
    const approveUrl = await browser.opened;

    await flow.complete({ code: "ABCD-EFGH", state: "0".repeat(32) });
    expect(flow.get()).toStrictEqual({ kind: "pairing" });
    await flow.startPair();
    expect(browser.opens).toBe(1);

    await flow.complete(approvalOf(approveUrl));
    expect(paired).toStrictEqual([REDEEMED]);
    expect(flow.get()).toStrictEqual({ kind: "idle" });

    browser.comeBack(approvalOf(approveUrl));
    await run;
    expect(paired).toHaveLength(1);
    expect(flow.get()).toStrictEqual({ kind: "idle" });
  });

  it("shows a mismatch the browser itself brought back — that session is over", async () => {
    const { browser, paired, flow } = harness({ fetch: redeemOk });
    const run = flow.startPair();
    await browser.opened;
    browser.comeBack({ code: "ABCD-EFGH", state: "0".repeat(32) });
    await run;
    expect(paired).toHaveLength(0);
    expect(flow.get()).toStrictEqual({
      kind: "failed",
      message: "That approval did not match the pairing this app started.",
    });
  });

  it("lands a thrown port as a failure, not a spinner that never ends", async () => {
    const { browser, flow } = harness({
      fetch: redeemOk,
      onPaired: () => Promise.reject(new Error("keychain unavailable")),
    });
    const run = flow.startPair();
    browser.comeBack(approvalOf(await browser.opened));
    await run;
    expect(flow.get()).toStrictEqual({ kind: "failed", message: "keychain unavailable" });
  });
});
