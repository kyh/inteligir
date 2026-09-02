import {
  redeemDevice,
  type CloudEndpoint,
  type CloudFailure,
  type CloudFetch,
} from "../cloud-client";
import { createApprovalSlot, type ApprovalSlotArgs } from "./approval-slot";
import {
  buildPairApproveUrl,
  createPkcePair,
  DEVICE_NAME_MAX_LENGTH,
  webPkceCrypto,
  type DeviceCredential,
  type PkceCrypto,
} from "./pairing-schema";

// not the code's TTL: this clock starts a whole sign-in round trip before the code is minted
export const PENDING_PAIR_TTL_MS = 10 * 60_000;

// a raw hostname can be empty or over the cloud's ceiling, refused steps later as a shape error
export function normalizeDeviceName(raw: string): string {
  const name = raw.trim().slice(0, DEVICE_NAME_MAX_LENGTH);
  return name.length === 0 ? "this device" : name;
}

export interface PairCallback {
  code: string;
  state: string;
}

export type PairCompletion =
  | { kind: "paired"; credential: DeviceCredential }
  | { kind: "no-pending" }
  | { kind: "state-mismatch" }
  | { kind: "expired" }
  | { kind: "refused"; failure: CloudFailure };

interface PendingPair {
  // the PKCE secret: only its challenge rides the browser, and redeem needs this back
  verifier: string;
  deviceName: string;
}

export interface PairingFlowArgs {
  cloudUrl: string;
  fetch?: CloudFetch;
  crypto?: PkceCrypto;
  now?: () => number;
}

export interface PairingBeginArgs {
  // already through pairRedirectUrlSchema; this machine does not re-judge it
  redirect: string;
  deviceName: string;
}

export interface PairingBegin {
  url: string;
  deviceName: string;
  expiresInMs: number;
}

export interface PairingFlow {
  begin(args: PairingBeginArgs): Promise<PairingBegin>;
  complete(callback: PairCallback): Promise<PairCompletion>;
  cancel(): void;
}

export function createPairingFlow(args: PairingFlowArgs): PairingFlow {
  const pkceCrypto = args.crypto ?? webPkceCrypto;
  const slotArgs: ApprovalSlotArgs = { ttlMs: PENDING_PAIR_TTL_MS, crypto: pkceCrypto };
  if (args.now !== undefined) slotArgs.now = args.now;
  const slot = createApprovalSlot<PendingPair>(slotArgs);

  function endpoint(): CloudEndpoint {
    const target: CloudEndpoint = { baseUrl: args.cloudUrl };
    if (args.fetch !== undefined) target.fetch = args.fetch;
    return target;
  }

  return {
    async begin(request): Promise<PairingBegin> {
      const deviceName = normalizeDeviceName(request.deviceName);
      const pkce = await createPkcePair(pkceCrypto);
      const state = slot.arm({ verifier: pkce.verifier, deviceName });
      const url = buildPairApproveUrl(args.cloudUrl, {
        redirect: request.redirect,
        state,
        name: deviceName,
        challenge: pkce.challenge,
      });
      return { url, deviceName, expiresInMs: PENDING_PAIR_TTL_MS };
    },

    async complete(callback): Promise<PairCompletion> {
      // claim before redeem: a state that survives its own redeem is a callback replayable from history
      const claim = slot.claim(callback.state);
      if (claim.kind !== "claimed") {
        return { kind: claim.kind };
      }
      const redeemed = await redeemDevice(endpoint(), {
        code: callback.code,
        deviceName: claim.payload.deviceName,
        verifier: claim.payload.verifier,
      });
      if (!redeemed.ok) {
        return { kind: "refused", failure: redeemed.failure };
      }
      return { kind: "paired", credential: redeemed.value };
    },

    cancel: () => slot.clear(),
  };
}
