// one slot per browser round trip: a second arm replaces the first. a matching claim consumes
// the slot before the caller exchanges anything, so a callback replayed from browser history
// completes nothing; a wrong state leaves it armed, or any local page could cancel a dance.

import { constantTimeEqual, hexFromBytes } from "./bytes";

export const APPROVAL_STATE_BYTES = 16;
export const APPROVAL_STATE_PATTERN = /^[0-9a-f]{32}$/;

export type ApprovalClaim<T> =
  | { kind: "claimed"; payload: T }
  | { kind: "no-pending" }
  | { kind: "expired" }
  | { kind: "state-mismatch" };

export interface ApprovalSlotArgs {
  ttlMs: number;
  now?: () => number;
}

export interface ApprovalSlot<T> {
  arm(payload: T): string;
  claim(state: string): ApprovalClaim<T>;
  clear(): void;
}

export function createApprovalSlot<T>(args: ApprovalSlotArgs): ApprovalSlot<T> {
  const now = args.now ?? Date.now;
  let pending: { state: string; payload: T; expiresAt: number } | null = null;

  return {
    arm(payload) {
      const state = hexFromBytes(crypto.getRandomValues(new Uint8Array(APPROVAL_STATE_BYTES)));
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

    clear() {
      pending = null;
    },
  };
}
