import { describeCloudFailure } from "@repo/api/cloud/client";
import type { PairCallback, PairingFlow } from "@repo/api/cloud/pairing/pairing-flow";
import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";
import { createExternalStore, type ReadableStore } from "../lib/external-store";

export type PairingState =
  | { kind: "idle" }
  | { kind: "pairing" }
  | { kind: "failed"; message: string };

type CallbackOrigin = "browser" | "deep-link";

export interface PairingStoreArgs {
  machine: PairingFlow;
  redirect: string;
  deviceName: string;
  openApprove: (approveUrl: string) => Promise<PairCallback | null>;
  onPaired: (credential: DeviceCredential) => Promise<void>;
}

export interface PairingStore extends ReadableStore<PairingState> {
  startPair(): Promise<void>;
  complete(callback: PairCallback): Promise<void>;
}

export function createPairingStore(args: PairingStoreArgs): PairingStore {
  const state = createExternalStore<PairingState>({ kind: "idle" });

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
        // the other path took the approval; this one is a replay.
        return;
      case "state-mismatch":
        // a foreign deep link while our browser is still open settles nothing: showing a failure
        // would re-enable the button, and its press replaces the slot the real approval still
        // expects.
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
        // the deep-link path may have settled this pairing while the browser was open.
        if (state.get().kind === "pairing") state.set({ kind: "idle" });
        return;
      }
      await settle(callback, "browser");
    });
  }

  return { subscribe: state.subscribe, get: state.get, startPair, complete };
}
