// One responsibility: the two halves of device pairing as this server runs
// them, over the contract's own machine
// (`@repo/api/cloud/pairing/pairing-flow`). A browser is in the middle of
// them: `beginPair` arms a single-use `state` and answers the approve page's
// URL, and `completePair` is what the loopback callback runs when that browser
// comes back. The state is this app's, not the route's, because it is the
// thing that says a callback belongs to a request THIS app made. The slot,
// the TTL, the constant-time state compare and the PKCE-bound redeem are the
// machine's; what is this server's is the hostname default, the browser
// opener, the `disposed` guard on both halves, and the session the runtime
// opens on success.

import { hostname } from "node:os";
import type { CloudFetch } from "@repo/api/cloud/client";
import {
  createPairingFlow,
  type PairCompletion as PairingMachineCompletion,
  type PairingFlowArgs,
} from "@repo/api/cloud/pairing/pairing-flow";
import type {
  CloudPairBeginResponse,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import type { OpenExternalUrl } from "./browser-opener";
import type { DeviceCredential } from "./credential-store";

/**
 * What the loopback callback did — the machine's own refusals, each of which
 * gets its own sentence on the page a browser lands on, with the paired arm
 * carrying the runtime's status instead of the bare credential.
 */
export type PairCompletion =
  | { kind: "paired"; status: CloudStatusResponse }
  | Exclude<PairingMachineCompletion, { kind: "paired" }>;

export interface BeginPairArgs {
  callbackUrl: string;
  deviceName?: string;
  openBrowser: boolean;
}

export interface PairFlowDeps {
  cloudUrl: string;
  /** Injected by a suite; absent, the redeem rides the global fetch. */
  fetch?: CloudFetch;
  openExternalUrl: OpenExternalUrl;
  isDisposed(): boolean;
  /** The runtime's re-pair choreography: stop the transport, reset the sync
   *  state, persist and open the fresh session, run the first pass. */
  adoptCredential(credential: DeviceCredential): Promise<void>;
  status(): CloudStatusResponse;
}

export interface PairFlow {
  /**
   * Arm an approval and hand back the page that grants it.
   *
   * `callbackUrl` is where the browser will be sent afterwards, and it has
   * ALREADY been through `pairRedirectUrlSchema` — `pair-callback.ts` is the
   * one gate, so nothing here re-decides which targets are admissible.
   */
  beginPair(request: BeginPairArgs): Promise<CloudPairBeginResponse>;
  /** Redeem `code`, but only for the approval this app is actually waiting on. */
  completePair(request: { code: string; state: string }): Promise<PairCompletion>;
  /** Drop any armed approval — an unpair, a dispose. */
  cancel(): void;
}

export function createPairFlow(deps: PairFlowDeps): PairFlow {
  const machineArgs: PairingFlowArgs = { cloudUrl: deps.cloudUrl };
  if (deps.fetch !== undefined) machineArgs.fetch = deps.fetch;
  const machine = createPairingFlow(machineArgs);

  return {
    async beginPair(request) {
      // `hostname()` raw: the machine bounds and defaults the name, so an
      // empty or oversized one never reaches the cloud as a shape error about
      // a name the user never typed.
      const { url, deviceName, expiresInMs } = await machine.begin({
        redirect: request.callbackUrl,
        deviceName: request.deviceName ?? hostname(),
      });
      if (deps.isDisposed()) {
        // Teardown has started: arm nothing and open nothing. The URL is still
        // answered so an in-flight caller gets a coherent reply, but no slot
        // outlives the process — and `completePair` refuses a disposed runtime
        // regardless.
        machine.cancel();
        return { url, opened: false, deviceName, expiresInMs };
      }
      // Awaited, so `opened` is observed rather than assumed — and false is an
      // ordinary answer here, since the caller may have asked for no window at
      // all.
      const opened = request.openBrowser ? await deps.openExternalUrl(url) : false;
      return { url, opened, deviceName, expiresInMs };
    },

    async completePair(request) {
      if (deps.isDisposed()) {
        // A callback in flight during ordered shutdown must not redeem over the
        // network and write a credential after teardown. Same answer as an
        // unarmed slot: nothing was completable.
        return { kind: "no-pending" };
      }
      const completion = await machine.complete(request);
      if (completion.kind !== "paired") {
        return completion;
      }
      if (deps.isDisposed()) {
        // Teardown ran during the redeem round trip: do not write a credential
        // or open a session after the process was told to stop.
        return { kind: "no-pending" };
      }
      await deps.adoptCredential(completion.credential);
      return { kind: "paired", status: deps.status() };
    },

    cancel: () => machine.cancel(),
  };
}
