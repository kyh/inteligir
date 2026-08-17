import { describe, expect, it } from "vitest";
import {
  ackCapturesRequestSchema,
  ackCapturesResponseSchema,
  captureRequestSchema,
} from "../captures";
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

  it("names the outbox position on a sync refusal", () => {
    const envelope = cloudError("sync-conflict", "already stored with a different body", 7);
    expect(cloudErrorSchema.parse(envelope).error.deviceSeq).toBe(7);
    // Absent rather than null everywhere else — a client reading `deviceSeq`
    // on a pairing refusal is asking the wrong question.
    expect("deviceSeq" in cloudError("unauthorized", "nope").error).toBe(false);
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
      threads: [{ threadId: "th_1", lane: "desktop", title: "Fix the build", updatedAt: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it("demands the client's own timestamp on a metadata upsert", () => {
    // Without it the server cannot tell a delayed retry from the newest fact,
    // so the field is required rather than defaulted.
    const result = pushRequestSchema.safeParse({
      events: [],
      threads: [{ threadId: "th_1", lane: "desktop" }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an event body over the byte ceiling", () => {
    const result = pushRequestSchema.safeParse({
      events: [
        { threadId: "th_1", deviceSeq: 1, event: "x".repeat(EVENT_MAX_BYTES + 1), createdAt: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("measures the ceiling in UTF-8 bytes, not UTF-16 units", () => {
    // Each of these is ONE UTF-16 unit and THREE UTF-8 bytes. A length-based
    // ceiling would wave through a body three times the size storage pays for.
    const wide = "あ".repeat(EVENT_MAX_BYTES / 3);
    expect(wide.length).toBeLessThan(EVENT_MAX_BYTES);
    const result = pushRequestSchema.safeParse({
      events: [{ threadId: "th_1", deviceSeq: 1, event: wide, createdAt: 1 }],
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

describe("capture handoff", () => {
  it("demands an idempotency key, so a retried share-sheet post is one capture", () => {
    expect(captureRequestSchema.safeParse({ text: "buy oat milk" }).success).toBe(false);
    expect(
      captureRequestSchema.safeParse({ text: "buy oat milk", idempotencyKey: "k".repeat(8) })
        .success,
    ).toBe(true);
  });

  it("acks by claim token and answers per id", () => {
    const parsed = ackCapturesResponseSchema.parse({
      results: [
        { id: "c1", outcome: "deleted" },
        { id: "c2", outcome: "reclaimed" },
        { id: "c3", outcome: "unknown" },
      ],
    });
    expect(parsed.results.map((row) => row.outcome)).toEqual(["deleted", "reclaimed", "unknown"]);
    // An aggregate count cannot say WHICH apply committed, so there is no
    // shape here that admits one.
    expect(ackCapturesRequestSchema.safeParse({ ids: ["c1"] }).success).toBe(false);
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
