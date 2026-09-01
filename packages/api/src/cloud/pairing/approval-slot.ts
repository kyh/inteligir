// ONE pending approval, because every browser-approval dance this repo runs
// (device pairing, connector OAuth) obeys the same discipline — and a
// security-bearing discipline with two spellings is two spellings to audit.
//
// A SINGLE armed slot: a second `arm` is the button pressed again, and two
// live states would let an approval complete a request nobody remembers
// making. A 128-bit `state` compared in constant time. A TTL, because a state
// left armed forever is a callback URL that keeps working long after the user
// forgot they asked for one. And CONSUME-BEFORE-EXCHANGE: a matching claim
// empties the slot before the caller redeems anything, so a callback URL
// replayed out of a browser history completes nothing. A wrong state does NOT
// consume the slot — it is somebody else's traffic, and spending the approval
// for it would let any local page cancel a dance the user is halfway through.

import { constantTimeEqual, hexFromBytes } from "../bytes";
import { PAIR_STATE_BYTES, webPkceCrypto, type PkceCrypto } from "./pairing-schema";

export type ApprovalClaim<T> =
  | { kind: "claimed"; payload: T }
  | { kind: "no-pending" }
  | { kind: "expired" }
  | { kind: "state-mismatch" };

export interface ApprovalSlotArgs {
  /** How long an armed approval stays claimable. The caller's, because each
   *  dance bounds a different clock. */
  ttlMs: number;
  /** Injected where the web-crypto globals are unreliable (Hermes). */
  crypto?: Pick<PkceCrypto, "randomBytes">;
  now?: () => number;
}

export interface ApprovalSlot<T> {
  /** Arm the slot — replacing whatever was armed — and mint its state. */
  arm(payload: T): string;
  /** The callback's half: judge `state` against the armed approval. A match
   *  CONSUMES the slot before the caller exchanges anything; expiry consumes
   *  it too; a mismatch leaves it armed. */
  claim(state: string): ApprovalClaim<T>;
  isPending(): boolean;
  /** Disarm without a callback (the user cancelled, an unpair, a teardown). */
  clear(): void;
}

export function createApprovalSlot<T>(args: ApprovalSlotArgs): ApprovalSlot<T> {
  const crypto = args.crypto ?? webPkceCrypto;
  const now = args.now ?? Date.now;
  let pending: { state: string; payload: T; expiresAt: number } | null = null;

  return {
    arm(payload) {
      const state = hexFromBytes(crypto.randomBytes(PAIR_STATE_BYTES));
      pending = { state, payload, expiresAt: now() + args.ttlMs };
      return state;
    },

    claim(state) {
      const current = pending;
      if (current === null) {
        return { kind: "no-pending" };
      }
      if (now() > current.expiresAt) {
        pending = null;
        return { kind: "expired" };
      }
      if (!constantTimeEqual(state, current.state)) {
        return { kind: "state-mismatch" };
      }
      pending = null;
      return { kind: "claimed", payload: current.payload };
    },

    isPending() {
      return pending !== null;
    },

    clear() {
      pending = null;
    },
  };
}
