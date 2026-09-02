// The app half of browser-approve pairing, as ONE machine every platform
// runs: mint a PKCE verifier, arm the approval slot, compose the account's
// approve page, and complete only the approval THIS app is waiting on — the
// slot's constant-time state compare and consume-before-exchange
// (`approval-slot.ts`), then a redeem carrying the secret verifier so an
// intercepted code alone cannot be spent. The CLI and the phone both run it;
// a security-bearing state machine with two implementations is two
// implementations to audit.
//
// What stays platform code is everything around the handshake: opening the
// browser, where the callback lands (a loopback route, a deep link), writing
// the credential, and opening a sync session on it.

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

/**
 * How long an approval this app started stays completable.
 *
 * Its own constant rather than the code's TTL: the two bound different things.
 * The code's clock starts when the user presses Approve; this one starts a
 * whole sign-in round trip earlier, and the reason it is bounded at all is that
 * a `state` left armed forever is a callback URL that keeps working long after
 * the user forgot they asked for one.
 */
export const PENDING_PAIR_TTL_MS = 10 * 60_000;

/** What this device calls itself on the account: bounded and defaulted rather
 *  than trusted, because the raw name (a hostname, an OS device name) can be
 *  empty or exceed the cloud's ceiling — and either would be refused several
 *  steps later, as a shape error about a name the user never typed. */
export function normalizeDeviceName(raw: string): string {
  const name = raw.trim().slice(0, DEVICE_NAME_MAX_LENGTH);
  return name.length === 0 ? "this device" : name;
}

/** The `code` + `state` a callback URL carries back. */
export interface PairCallback {
  code: string;
  state: string;
}

/**
 * What the callback did. Each refusal is its own member because each one gets
 * its own sentence on whatever surface the callback lands on — "nothing was
 * waiting for this" and "that took too long" are different things to have
 * done wrong, and a single `false` would render as the same shrug for both.
 */
export type PairCompletion =
  | { kind: "paired"; credential: DeviceCredential }
  | { kind: "no-pending" }
  | { kind: "state-mismatch" }
  | { kind: "expired" }
  | { kind: "refused"; failure: CloudFailure };

/** What the slot holds for the approval this app is waiting on. */
interface PendingPair {
  /** The PKCE secret. Kept HERE, never on the wire the browser rides: the
   *  challenge it hashes to is all that travels, and redeem needs this back to
   *  prove the code reached the app that began the pairing. */
  verifier: string;
  deviceName: string;
}

export interface PairingFlowArgs {
  cloudUrl: string;
  /** Injected so a suite can drive the whole handshake without a network. */
  fetch?: CloudFetch;
  /** Injected where the web-crypto globals are unreliable (Hermes). */
  crypto?: PkceCrypto;
  now?: () => number;
}

export interface PairingBeginArgs {
  /** Where the approve page sends the browser back. Already through
   *  `pairRedirectUrlSchema` — the platform's callback gate is the one place
   *  that decides which targets are admissible. */
  redirect: string;
  deviceName: string;
}

export interface PairingBegin {
  /** The account's approve page, to open in the system browser. */
  url: string;
  /** The name as it will reach the account — {@link normalizeDeviceName}d. */
  deviceName: string;
  expiresInMs: number;
}

export interface PairingFlow {
  /** Arm one approval and compose the page that grants it. */
  begin(args: PairingBeginArgs): Promise<PairingBegin>;
  /** Redeem `code`, but only for the approval this app is actually waiting on. */
  complete(callback: PairCallback): Promise<PairCompletion>;
  /** Drop any armed approval (the user cancelled, an unpair, a teardown). */
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
      // Anything can reach a callback surface (a loopback route any local
      // page can navigate, a deep link any site can compose); the slot is
      // what makes one nobody here armed do nothing at all, and it CONSUMES
      // a matching state before the redeem below — a state that survived its
      // own redeem is a callback URL replayable out of a browser's history.
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
