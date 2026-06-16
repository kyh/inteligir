import { describe, expect, it } from "vitest";

import { planSweep, ROOM_IDLE_TTL_MS, type RoomClaim } from "./housekeeping";

const claim: RoomClaim = { tokenHash: "abc123", claimedAt: 0, lastSeenAt: 0 };

describe("planSweep", () => {
  it("deletes expired and malformed dedup entries, keeps live ones", () => {
    const plan = planSweep({
      nowMs: 1000,
      dedupeEntries: new Map<string, unknown>([
        ["dedupe:expired", 500],
        ["dedupe:malformed", "junk"],
        ["dedupe:live", 2000],
      ]),
      claim: null,
      hasLiveConnections: false,
      idleTtlMs: ROOM_IDLE_TTL_MS,
    });
    expect(plan.deleteKeys.toSorted()).toEqual(["dedupe:expired", "dedupe:malformed"]);
    expect(plan.nextAlarmAtMs).toBe(2000);
    expect(plan.claimAction).toEqual({ kind: "keep" });
  });

  it("touches the claim and reschedules while connections are live", () => {
    const nowMs = ROOM_IDLE_TTL_MS * 2; // far past idle, but the room is in use
    const plan = planSweep({
      nowMs,
      dedupeEntries: new Map(),
      claim,
      hasLiveConnections: true,
      idleTtlMs: ROOM_IDLE_TTL_MS,
    });
    expect(plan.claimAction).toEqual({ kind: "touch", lastSeenAt: nowMs });
    expect(plan.nextAlarmAtMs).toBe(nowMs + ROOM_IDLE_TTL_MS);
  });

  it("expires a claim idle past the TTL", () => {
    const plan = planSweep({
      nowMs: ROOM_IDLE_TTL_MS,
      dedupeEntries: new Map(),
      claim,
      hasLiveConnections: false,
      idleTtlMs: ROOM_IDLE_TTL_MS,
    });
    expect(plan.claimAction).toEqual({ kind: "expire" });
    expect(plan.nextAlarmAtMs).toBeNull();
  });

  it("keeps a not-yet-idle claim and schedules its expiry", () => {
    const plan = planSweep({
      nowMs: 1000,
      dedupeEntries: new Map(),
      claim,
      hasLiveConnections: false,
      idleTtlMs: ROOM_IDLE_TTL_MS,
    });
    expect(plan.claimAction).toEqual({ kind: "keep" });
    expect(plan.nextAlarmAtMs).toBe(claim.lastSeenAt + ROOM_IDLE_TTL_MS);
  });

  it("schedules the earliest of dedup expiry and claim expiry", () => {
    const plan = planSweep({
      nowMs: 1000,
      dedupeEntries: new Map<string, unknown>([["dedupe:live", 5000]]),
      claim,
      hasLiveConnections: false,
      idleTtlMs: ROOM_IDLE_TTL_MS,
    });
    expect(plan.nextAlarmAtMs).toBe(5000);
  });
});
