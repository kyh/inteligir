// The pairing FLOW — from the press to a credential this device owns — as ONE
// state machine the screen reads through `useSyncExternalStore`. Two paths feed
// it: the in-session browser return, and the deep-link listener (a redirect that
// lands after the app was backgrounded during approval). Both converge on
// `complete`, so a failure computed on either path is SHOWN — a state local to
// the screen's own call could only see the path that ran inside it.
//
// The handshake itself — the slot, the TTL, the constant-time state compare,
// consume-before-redeem, PKCE — is the contract's own machine
// (`@repo/api/cloud/pairing/pairing-flow`); what this store owns is what the
// SCREEN sees between the press and the credential landing. The browser and
// the credential handover stay injected ports, so the suite drives the whole
// flow over the real machine with a fake redeem.

import { describeCloudFailure } from "@repo/api/cloud/client";
import type {
  PairCallback,
  PairingFlow as PairingMachine,
} from "@repo/api/cloud/pairing/pairing-flow";
import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";
import { createExternalStore, type ReadableStore } from "../lib/external-store";

export type PairingState =
  | { kind: "idle" }
  /** From the press until the credential is this device's, or the flow ends. */
  | { kind: "pairing" }
  | { kind: "failed"; message: string };

export interface PairingFlowArgs {
  machine: PairingMachine;
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

export interface PairingFlow extends ReadableStore<PairingState> {
  // Property-function types because the screen passes them by reference.
  startPair: () => Promise<void>;
  /** A callback that arrived outside the browser session. */
  complete: (callback: PairCallback) => Promise<void>;
}

export function createPairingFlow(args: PairingFlowArgs): PairingFlow {
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

  function complete(callback: PairCallback): Promise<void> {
    return guarded(async () => {
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
    });
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
      await complete(callback);
    });
  }

  return { subscribe: state.subscribe, get: state.get, startPair, complete };
}
