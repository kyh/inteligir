// Browser-approve pairing, from the phone — the two halves the desktop's
// sync-runtime carries (issue #573), adapted to a deep-link callback.
//
// A phone has no loopback server, so where the desktop redirects to
// `http://127.0.0.1:<port>/pair/callback`, the phone redirects to its own custom
// scheme `inteligir://pair/callback`. Everything else is the desktop's flow:
// mint a single-use `state` and a PKCE verifier, open the account's approve page,
// and complete only the approval THIS app is waiting on — constant-time state
// compare, consumed BEFORE the redeem, redeemed with the secret verifier so an
// intercepted code alone cannot be spent.
//
// THE REDIRECT IS ALLOWLISTED BY THE CONTRACT: `pairRedirectUrlSchema` admits
// exactly two shapes — the loopback callback and this one registered
// custom-scheme callback — each judged field-by-field, no wildcards. The
// residual an allowlist cannot reach — another app registering `inteligir://`
// on the same OS receives the redirect, code included — is held by PKCE: the
// verifier never leaves this app, and redeem refuses a code without it.
// This module is pure and touches no `expo-*`: the browser + deep-link wiring is
// expo-pairing.ts, and the press-to-paired state machine is pairing-flow.ts.

import {
  buildPairApproveUrl,
  DEVICE_NAME_MAX_LENGTH,
  PAIR_STATE_BYTES,
} from "@repo/api/cloud/pairing/pairing-schema";
import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";
import {
  redeemDevice,
  type CloudEndpoint,
  type CloudFailure,
  type CloudFetch,
} from "@repo/api/cloud/client";
import { createPkcePair, hexFromBytes, type PkceCrypto } from "./pkce";

/**
 * How long an approval this app started stays completable — its own constant
 * rather than the code's TTL, because this clock starts a whole sign-in round
 * trip earlier, and a `state` left armed forever is a callback URL that keeps
 * working long after the user forgot they asked for one.
 */
const PENDING_PAIR_TTL_MS = 10 * 60_000;

/** The approval this app is waiting on. ONE slot: a second `begin` is the user
 *  pressing the button again, and two live states would let an approval complete
 *  a request nobody remembers making. */
interface PendingPair {
  state: string;
  /** The PKCE secret, kept HERE and never on the wire the browser rides. */
  verifier: string;
  deviceName: string;
  expiresAt: number;
}

/** The `code` + `state` a callback URL carries back. */
export interface PairCallback {
  code: string;
  state: string;
}

/** What the callback did — each refusal its own member, because each is a
 *  different thing to tell the user. */
type PairCompletion =
  | { kind: "paired"; credential: DeviceCredential }
  | { kind: "no-pending" }
  | { kind: "state-mismatch" }
  | { kind: "expired" }
  | { kind: "refused"; failure: CloudFailure };

export interface PairingManagerArgs {
  cloudUrl: string;
  /** The app's own deep-link redirect target, e.g. `inteligir://pair/callback`. */
  callbackUrl: string;
  crypto: PkceCrypto;
  /** What this device calls itself on the account. */
  deviceName: string;
  fetch?: CloudFetch;
  now?: () => number;
}

export interface PairingManager {
  /** Arm one approval; answers the account's approve page, to open in the
   *  system browser. */
  beginPair(): Promise<string>;
  completePair(callback: PairCallback): Promise<PairCompletion>;
  /** Drop any armed approval (the user cancelled). */
  cancel(): void;
}

/** Constant-time compare over two strings — no `node:crypto` on RN, so the
 *  accumulate-xor is spelled out. Length is compared first; the state is a fixed
 *  32-hex, so the length is not a secret. */
function sameState(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

export function createPairingManager(args: PairingManagerArgs): PairingManager {
  const now = args.now ?? Date.now;
  let pending: PendingPair | null = null;

  function endpoint(): CloudEndpoint {
    const target: CloudEndpoint = { baseUrl: args.cloudUrl };
    if (args.fetch !== undefined) target.fetch = args.fetch;
    return target;
  }

  return {
    async beginPair(): Promise<string> {
      const name = args.deviceName.trim().slice(0, DEVICE_NAME_MAX_LENGTH);
      const state = hexFromBytes(args.crypto.randomBytes(PAIR_STATE_BYTES));
      const pkce = await createPkcePair(args.crypto);
      pending = {
        state,
        verifier: pkce.verifier,
        deviceName: name,
        expiresAt: now() + PENDING_PAIR_TTL_MS,
      };
      return buildPairApproveUrl(args.cloudUrl, {
        redirect: args.callbackUrl,
        state,
        name,
        challenge: pkce.challenge,
      });
    },

    async completePair(callback): Promise<PairCompletion> {
      const current = pending;
      if (current === null) return { kind: "no-pending" };
      if (now() > current.expiresAt) {
        pending = null;
        return { kind: "expired" };
      }
      if (!sameState(callback.state, current.state)) {
        // NOT consumed: a wrong state is somebody else's traffic, and discarding
        // the slot for it would let any deep-link cancel a pairing in flight.
        return { kind: "state-mismatch" };
      }
      // CONSUMED BEFORE THE REDEEM — a state that survived its own redeem is a
      // callback URL that could be replayed out of history.
      pending = null;
      const redeemed = await redeemDevice(endpoint(), {
        code: callback.code,
        deviceName: current.deviceName,
        verifier: current.verifier,
      });
      if (!redeemed.ok) return { kind: "refused", failure: redeemed.failure };
      return {
        kind: "paired",
        credential: { deviceId: redeemed.value.deviceId, credential: redeemed.value.credential },
      };
    },

    cancel(): void {
      pending = null;
    },
  };
}
