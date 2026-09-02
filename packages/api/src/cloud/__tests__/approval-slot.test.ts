import { describe, expect, it } from "vitest";
import { createApprovalSlot, type ApprovalSlot } from "../pairing/approval-slot";
import { PAIR_STATE_PATTERN } from "../pairing/pairing-schema";

const TTL_MS = 1_000;

function slotWith(now?: () => number): ApprovalSlot<string> {
  const args: Parameters<typeof createApprovalSlot>[0] = { ttlMs: TTL_MS };
  if (now !== undefined) args.now = now;
  return createApprovalSlot<string>(args);
}

describe("createApprovalSlot", () => {
  it("mints a fresh 128-bit state per arm and claims exactly once", () => {
    const slot = slotWith();
    const state = slot.arm("payload");
    expect(state).toMatch(PAIR_STATE_PATTERN);

    expect(slot.claim(state)).toStrictEqual({ kind: "claimed", payload: "payload" });
    expect(slot.claim(state)).toStrictEqual({ kind: "no-pending" });
  });

  it("refuses a wrong state WITHOUT spending the armed approval", () => {
    const slot = slotWith();
    const state = slot.arm("payload");
    expect(slot.claim("f".repeat(32))).toStrictEqual({ kind: "state-mismatch" });
    expect(slot.claim(state)).toStrictEqual({ kind: "claimed", payload: "payload" });
  });

  it("holds ONE slot: a second arm invalidates the first state", () => {
    const slot = slotWith();
    const stale = slot.arm("first");
    const live = slot.arm("second");
    expect(stale).not.toBe(live);
    expect(slot.claim(stale)).toStrictEqual({ kind: "state-mismatch" });
    expect(slot.claim(live)).toStrictEqual({ kind: "claimed", payload: "second" });
  });

  it("expires, consuming the slot when it does", () => {
    let nowValue = 1_000;
    const slot = slotWith(() => nowValue);
    const state = slot.arm("payload");
    nowValue += TTL_MS;
    expect(slot.claim(state)).toStrictEqual({ kind: "claimed", payload: "payload" });

    const late = slot.arm("payload");
    nowValue += TTL_MS + 1;
    expect(slot.claim(late)).toStrictEqual({ kind: "expired" });
    expect(slot.claim(late)).toStrictEqual({ kind: "no-pending" });
  });

  it("clear disarms without a callback", () => {
    const slot = slotWith();
    const state = slot.arm("payload");
    slot.clear();
    expect(slot.claim(state)).toStrictEqual({ kind: "no-pending" });
  });
});
