import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Durable Object storage layout + alarm sweep planning.
//
// A DispatchServer instance is one of two things, decided by its name:
//
//  - a relay **room** (name = a canonical roomId): stores the room claim
//    under CLAIM_KEY — the SHA-256 hash of the pairing token, never the
//    plaintext (see packages/dispatch/PROTOCOL.md).
//  - the **webhook-dedup** instance (name = DEDUPE_INSTANCE_NAME, which can
//    never be a valid roomId, so it can never be claimed or connected to):
//    stores one `dedupe:<key>` → expiry-timestamp entry per processed
//    webhook event.
//
// Both kinds are swept by the same alarm: expired dedup entries are deleted,
// and a claimed room idle past ROOM_IDLE_TTL_MS loses its claim (the room
// "expires"; the desktop re-claims on its next connect, stale credentials
// die with it). `planSweep` is pure so the policy is unit-testable.
// ---------------------------------------------------------------------------

/** Storage key holding a room's claim. */
export const CLAIM_KEY = "claim";

/** Storage-key prefix for webhook-dedup entries; values are expiry ms. */
export const DEDUPE_PREFIX = "dedupe:";

/** Name of the dedicated webhook-dedup DO instance. Lowercase + dash means it
 * never matches the roomId alphabet, so it is unreachable over WebSocket. */
export const DEDUPE_INSTANCE_NAME = "webhook-dedup";

/** A claimed room with no connection activity for this long expires. */
export const ROOM_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The room claim, validated on every read — storage is a trust boundary
 * (an older/newer deploy may have written a different shape). */
export const RoomClaimSchema = Type.Object({
  /** SHA-256 (lowercase hex) of the pairing token. Plaintext never stored. */
  tokenHash: Type.String(),
  /** When the desktop first claimed this room (ms epoch). */
  claimedAt: Type.Number(),
  /** Last connect/disconnect/sweep activity (ms epoch); drives idle expiry. */
  lastSeenAt: Type.Number(),
});
export type RoomClaim = Static<typeof RoomClaimSchema>;

type ClaimAction = { kind: "keep" } | { kind: "touch"; lastSeenAt: number } | { kind: "expire" };

export type SweepPlan = {
  /** Dedup storage keys to delete (expired or malformed). */
  deleteKeys: string[];
  claimAction: ClaimAction;
  /** When the alarm should fire next, or null if nothing is pending. */
  nextAlarmAtMs: number | null;
};

/** Decide what an alarm firing at `nowMs` should do. Pure. */
export function planSweep(input: {
  nowMs: number;
  /** Raw `dedupe:*` entries as read from storage (values untrusted). */
  dedupeEntries: ReadonlyMap<string, unknown>;
  claim: RoomClaim | null;
  hasLiveConnections: boolean;
  idleTtlMs: number;
}): SweepPlan {
  const deleteKeys: string[] = [];
  let nextAlarmAtMs: number | null = null;
  const propose = (atMs: number): void => {
    nextAlarmAtMs = nextAlarmAtMs === null ? atMs : Math.min(nextAlarmAtMs, atMs);
  };

  for (const [key, value] of input.dedupeEntries) {
    if (typeof value !== "number" || value <= input.nowMs) {
      deleteKeys.push(key);
    } else {
      propose(value);
    }
  }

  let claimAction: ClaimAction = { kind: "keep" };
  if (input.claim !== null) {
    if (input.hasLiveConnections) {
      // The room is in active use: refresh the idle clock.
      claimAction = { kind: "touch", lastSeenAt: input.nowMs };
      propose(input.nowMs + input.idleTtlMs);
    } else if (input.nowMs - input.claim.lastSeenAt >= input.idleTtlMs) {
      claimAction = { kind: "expire" };
    } else {
      propose(input.claim.lastSeenAt + input.idleTtlMs);
    }
  }

  return { deleteKeys, claimAction, nextAlarmAtMs };
}
