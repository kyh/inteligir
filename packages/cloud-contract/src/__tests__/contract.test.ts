import { describe, expect, it } from "vitest";
import { cloudError, cloudErrorSchema } from "../errors";
import {
  DEVICE_CREDENTIAL_PATTERN,
  PAIRING_CODE_PATTERN,
  redeemDeviceRequestSchema,
} from "../pairing";
import { EVENT_MAX_BYTES, pullQuerySchema, pushRequestSchema } from "../sync";
import { syncPingSchema } from "../ws";

describe("error envelope", () => {
  it("round-trips through its own schema", () => {
    const envelope = cloudError("unauthorized", "no device credential");
    expect(cloudErrorSchema.parse(envelope)).toEqual(envelope);
  });

  it("refuses an unknown code", () => {
    expect(cloudErrorSchema.safeParse({ error: { code: "teapot", message: "" } }).success).toBe(
      false,
    );
  });
});

describe("pairing grammar", () => {
  it("accepts the minted shape and refuses ambiguous characters", () => {
    expect(PAIRING_CODE_PATTERN.test("K7QP-2M4X")).toBe(true);
    expect(PAIRING_CODE_PATTERN.test("K0QP-2M4X")).toBe(false);
    expect(PAIRING_CODE_PATTERN.test("k7qp-2m4x")).toBe(false);
  });

  it("trims what a human pastes", () => {
    const parsed = redeemDeviceRequestSchema.parse({
      code: " K7QP-2M4X ",
      deviceName: "  Kaiyu's MacBook ",
    });
    expect(parsed.code).toBe("K7QP-2M4X");
    expect(parsed.deviceName).toBe("Kaiyu's MacBook");
  });

  it("pins the credential shape the server mints", () => {
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(64)}`)).toBe(true);
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(63)}`)).toBe(false);
    expect(DEVICE_CREDENTIAL_PATTERN.test("not-a-credential")).toBe(false);
  });
});

describe("push request", () => {
  it("accepts an opaque JSON event body", () => {
    const result = pushRequestSchema.safeParse({
      events: [
        {
          threadId: "th_1",
          deviceSeq: 1,
          event: { type: "turn/started", nested: [1, "x", null] },
          createdAt: 1,
        },
      ],
      threads: [{ threadId: "th_1", lane: "desktop", title: "Fix the build" }],
    });
    expect(result.success).toBe(true);
  });

  it("refuses an event body over the byte ceiling", () => {
    const result = pushRequestSchema.safeParse({
      events: [
        { threadId: "th_1", deviceSeq: 1, event: "x".repeat(EVENT_MAX_BYTES + 1), createdAt: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a non-JSON event body", () => {
    const result = pushRequestSchema.safeParse({
      events: [{ threadId: "th_1", deviceSeq: 1, event: undefined, createdAt: 1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("pull query", () => {
  it("coerces from query strings and defaults what is absent", () => {
    expect(pullQuerySchema.parse({ afterSeq: "41", limit: "2" })).toEqual({
      afterSeq: 41,
      limit: 2,
    });
    expect(pullQuerySchema.parse({})).toEqual({ afterSeq: 0, limit: 200 });
  });

  it("refuses a negative cursor", () => {
    expect(pullQuerySchema.safeParse({ afterSeq: "-1" }).success).toBe(false);
  });
});

describe("ws ping frames", () => {
  it("parses each server frame", () => {
    expect(syncPingSchema.parse({ type: "sync", seq: 12 }).type).toBe("sync");
    expect(syncPingSchema.parse({ type: "capture" }).type).toBe("capture");
    expect(syncPingSchema.parse({ type: "dispatch", threadId: "th_1" }).type).toBe("dispatch");
  });

  it("refuses a frame with extra fields — the server owns this boundary", () => {
    expect(syncPingSchema.safeParse({ type: "sync", seq: 1, extra: true }).success).toBe(false);
  });
});
