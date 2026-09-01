import type { CloudFetch } from "@repo/api/cloud/client";
import { describe, expect, it } from "vitest";
import type { DeviceCredential } from "../../credential/credential-codec";
import { createPairingFlow, type PairingFlow } from "../pairing-flow";
import { createPairingManager, type PairCallback } from "../pairing-manager";
import { CALLBACK, fakeCrypto, REDEEMED, redeemOk, redeemRefused, stateOf } from "./fakes";

// The flow over the REAL manager: what the screen sees between the press and
// the credential landing, on both the in-session and the deep-link path.

/** A browser the test drives by hand: `opened` settles with the approve URL
 *  the flow handed it, and `comeBack` is the redirect (or the user closing it). */
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

/** The callback the approve page composes for the approval this URL opened. */
function approvalOf(approveUrl: string): PairCallback {
  return { code: "ABCD-EFGH", state: stateOf(approveUrl) };
}

interface Harness {
  browser: FakeBrowser;
  paired: DeviceCredential[];
  flow: PairingFlow;
}

function harness(args: {
  fetch: CloudFetch;
  onPaired?: (credential: DeviceCredential) => Promise<void>;
}): Harness {
  const browser = fakeBrowser();
  const paired: DeviceCredential[] = [];
  const flow = createPairingFlow({
    manager: createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      deviceName: "Test Phone",
      fetch: args.fetch,
    }),
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

describe("the pairing flow", () => {
  it("is pairing while the browser is open, and idle once the credential is this device's", async () => {
    const { browser, paired, flow } = harness({ fetch: redeemOk });
    expect(flow.get()).toStrictEqual({ kind: "idle" });

    const run = flow.startPair();
    const approveUrl = await browser.opened;
    expect(flow.get()).toStrictEqual({ kind: "pairing" });
    // A second press while one is in flight opens nothing: one approval at a time.
    await flow.startPair();
    expect(browser.opens).toBe(1);
    // The snapshot is cached between changes — what useSyncExternalStore needs.
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
    // A callback that arrives late finds nothing armed and changes nothing.
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

    // Someone else's traffic on the deep link: shown, and the approval stays armed.
    await flow.complete({ code: "ABCD-EFGH", state: "0".repeat(32) });
    expect(flow.get()).toStrictEqual({
      kind: "failed",
      message: "That approval did not match the pairing this app started.",
    });

    // The real redirect lands as a deep link while the browser is still open.
    await flow.complete(approvalOf(approveUrl));
    expect(paired).toStrictEqual([REDEEMED]);
    expect(flow.get()).toStrictEqual({ kind: "idle" });

    // Then the browser session returns the same approval: it was already taken.
    browser.comeBack(approvalOf(approveUrl));
    await run;
    expect(paired).toHaveLength(1);
    expect(flow.get()).toStrictEqual({ kind: "idle" });
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
