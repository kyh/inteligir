import { describe, it, expect } from "vitest";
import { nextReconnectDelay, DEFAULT_RECONNECT_POLICY, type ReconnectPolicy } from "@/renderer/voice/reconnect";

describe("nextReconnectDelay", () => {
  it("returns base delay for first attempt", () => {
    expect(nextReconnectDelay(0, DEFAULT_RECONNECT_POLICY)).toBe(2_000);
  });

  it("doubles delay for each attempt", () => {
    expect(nextReconnectDelay(1, DEFAULT_RECONNECT_POLICY)).toBe(4_000);
    expect(nextReconnectDelay(2, DEFAULT_RECONNECT_POLICY)).toBe(8_000);
  });

  it("returns null when attempts exhausted", () => {
    expect(nextReconnectDelay(3, DEFAULT_RECONNECT_POLICY)).toBeNull();
    expect(nextReconnectDelay(10, DEFAULT_RECONNECT_POLICY)).toBeNull();
  });

  it("respects custom policy", () => {
    const policy: ReconnectPolicy = { maxAttempts: 2, baseDelayMs: 500 };
    expect(nextReconnectDelay(0, policy)).toBe(500);
    expect(nextReconnectDelay(1, policy)).toBe(1_000);
    expect(nextReconnectDelay(2, policy)).toBeNull();
  });

  it("returns null for attempt >= maxAttempts with zero max", () => {
    const policy: ReconnectPolicy = { maxAttempts: 0, baseDelayMs: 1_000 };
    expect(nextReconnectDelay(0, policy)).toBeNull();
  });
});
