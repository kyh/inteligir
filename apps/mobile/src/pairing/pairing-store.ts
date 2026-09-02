// The pairing FLOW — from the press to a credential this device owns — as ONE
// state machine the screen reads through `useSyncExternalStore`. Two paths feed
// it: the in-session browser return, and the deep-link listener (a redirect that
// lands after the app was backgrounded during approval). Both converge on
// `settle`, so a failure computed on either path is SHOWN — a state local to
// the screen's own call could only see the path that ran inside it.
//
// The handshake itself — the slot, the TTL, the constant-time state compare,
// consume-before-redeem, PKCE — is the contract's own machine
// (`@repo/api/cloud/pairing/pairing-flow`); what this store owns is what the
// SCREEN sees between the press and the credential landing. The browser and
// the credential handover stay injected ports, so the suite drives the whole
// flow over the real machine with a fake redeem.

import { describeCloudFailure } from "@repo/api/cloud/client";
import type { PairCallback, PairingFlow } from "@repo/api/cloud/pairing/pairing-flow";
import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";
import { createExternalStore, type ReadableStore } from "../lib/external-store";

export type PairingState =
  | { kind: "idle" }
  /** From the press until the credential is this device's, or the flow ends. */
  | { kind: "pairing" }
  | { kind: "failed"; message: string };

/** Where a callback came from: the browser this store opened, or the deep-link
 *  listener any app or site can reach. */
type CallbackOrigin = "browser" | "deep-link";

export interface PairingStoreArgs {
  machine: PairingFlow;
  /** This app's own deep-link callback, e.g. `inteligir://pair/callback`. */
  redirect: string;
  /** What this device calls itself on the account. */
  deviceName: string;
  /** Open the approve page and wait for the browser to come back through the
   *  callback; null when the user closed it. */
  openApprove: (approveUrl: string) => Promise<PairCallback | null>;
  /** Make the credential this device's — at rest, and as the sync switch. */
  onPaired: (credential: DeviceCredential) => Promise<void>;
}

export interface PairingStore extends ReadableStore<PairingState> {
  startPair(): Promise<void>;
  /** A callback that arrived outside the browser session. */
  complete(callback: PairCallback): Promise<void>;
}

export function createPairingStore(args: PairingStoreArgs): PairingStore {
  const state = createExternalStore<PairingState>({ kind: "idle" });

  /** A port that throws (the Keychain write, the browser) lands as a failure
   *  the screen shows, not a spinner that never ends. */
  async function guarded(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      state.set({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function settle(callback: PairCallback, origin: CallbackOrigin): Promise<void> {
    const completion = await args.machine.complete(callback);
    switch (completion.kind) {
      case "paired":
        await args.onPaired(completion.credential);
        state.set({ kind: "idle" });
        return;
      case "no-pending":
        // A redirect can arrive both in-session and as a deep link; whichever
        // path took the approval owns its outcome, and this one is a replay.
        return;
      case "state-mismatch":
        // The machine leaves the armed approval untouched on a mismatch, so a
        // foreign deep link while this store's own browser is still open
        // settles nothing — and showing it as a failure would re-enable the
        // button, whose press REPLACES the slot the real approval still
        // expects. The browser bringing back a wrong state is that session
        // over, and is shown.
        if (origin === "deep-link" && state.get().kind === "pairing") return;
        state.set({
          kind: "failed",
          message: "That approval did not match the pairing this app started.",
        });
        return;
      case "expired":
        state.set({ kind: "failed", message: "The pairing took too long — start another." });
        return;
      case "refused":
        state.set({ kind: "failed", message: describeCloudFailure(completion.failure) });
    }
  }

  function complete(callback: PairCallback): Promise<void> {
    return guarded(() => settle(callback, "deep-link"));
  }

  function startPair(): Promise<void> {
    if (state.get().kind === "pairing") return Promise.resolve();
    state.set({ kind: "pairing" });
    return guarded(async () => {
      const begun = await args.machine.begin({
        redirect: args.redirect,
        deviceName: args.deviceName,
      });
      const callback = await args.openApprove(begun.url);
      if (callback === null) {
        args.machine.cancel();
        // The deep-link path may have settled this pairing while the browser
        // was open; its outcome stands.
        if (state.get().kind === "pairing") state.set({ kind: "idle" });
        return;
      }
      await settle(callback, "browser");
    });
  }

  return { subscribe: state.subscribe, get: state.get, startPair, complete };
}
