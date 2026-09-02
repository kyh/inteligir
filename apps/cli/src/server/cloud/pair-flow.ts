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
  fetch?: CloudFetch;
  openExternalUrl: OpenExternalUrl;
  isDisposed(): boolean;
  adoptCredential(credential: DeviceCredential): Promise<void>;
  status(): CloudStatusResponse;
}

export interface PairFlow {
  /** callbackUrl has already passed pairRedirectUrlSchema; nothing here re-decides it. */
  beginPair(request: BeginPairArgs): Promise<CloudPairBeginResponse>;
  completePair(request: { code: string; state: string }): Promise<PairCompletion>;
  cancel(): void;
}

export function createPairFlow(deps: PairFlowDeps): PairFlow {
  const machineArgs: PairingFlowArgs = { cloudUrl: deps.cloudUrl };
  if (deps.fetch !== undefined) machineArgs.fetch = deps.fetch;
  const machine = createPairingFlow(machineArgs);

  return {
    async beginPair(request) {
      // raw hostname(): the machine bounds and defaults the name.
      const { url, deviceName, expiresInMs } = await machine.begin({
        redirect: request.callbackUrl,
        deviceName: request.deviceName ?? hostname(),
      });
      if (deps.isDisposed()) {
        // teardown started: arm nothing, open nothing; the url is still answered.
        machine.cancel();
        return { url, opened: false, deviceName, expiresInMs };
      }
      const opened = request.openBrowser ? await deps.openExternalUrl(url) : false;
      return { url, opened, deviceName, expiresInMs };
    },

    async completePair(request) {
      if (deps.isDisposed()) {
        // a callback in flight during shutdown must not redeem or write a credential.
        return { kind: "no-pending" };
      }
      const completion = await machine.complete(request);
      if (completion.kind !== "paired") {
        return completion;
      }
      if (deps.isDisposed()) {
        // teardown ran during the redeem round trip.
        return { kind: "no-pending" };
      }
      await deps.adoptCredential(completion.credential);
      return { kind: "paired", status: deps.status() };
    },

    cancel: () => machine.cancel(),
  };
}
