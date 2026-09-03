import { describe, expect, it } from "vitest";
import {
  changedMessageLenientSchema,
  changedMessageSchema,
  clientMessageSchema,
  realtimeSubscriptionTargetKey,
  serverMessageLenientSchema,
} from "../notifications";

describe("realtimeSubscriptionTargetKey", () => {
  it("keys list targets by kind", () => {
    expect(realtimeSubscriptionTargetKey({ kind: "vault" })).toBe("vault");
    expect(realtimeSubscriptionTargetKey({ kind: "thread-list" })).toBe("thread-list");
  });
});

describe("strict outbound schemas", () => {
  it("rejects an unknown change kind", () => {
    const result = changedMessageSchema.safeParse({
      type: "changed",
      entity: "doc",
      id: "d1",
      changes: ["content-changed", "not-a-kind"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown field", () => {
    const result = changedMessageSchema.safeParse({
      type: "changed",
      entity: "vault",
      changes: ["files-changed"],
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  it("requires an id on doc messages", () => {
    const result = changedMessageSchema.safeParse({
      type: "changed",
      entity: "doc",
      changes: ["content-changed"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a subscribe message with an extra target field", () => {
    const result = clientMessageSchema.safeParse({
      type: "subscribe",
      target: { kind: "vault", extra: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a subscribe message with an extra top-level field", () => {
    const result = clientMessageSchema.safeParse({
      type: "subscribe",
      target: { kind: "vault" },
      extra: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("lenient inbound schemas", () => {
  it("filters unknown change kinds instead of rejecting the message", () => {
    const result = changedMessageLenientSchema.parse({
      type: "changed",
      entity: "thread",
      id: "t1",
      changes: ["events-appended", "some-future-kind"],
    });
    expect(result.changes).toEqual(["events-appended"]);
  });

  it("strips unknown fields instead of rejecting the message", () => {
    const result = changedMessageLenientSchema.parse({
      type: "changed",
      entity: "vault",
      changes: ["files-changed"],
      futureField: { nested: true },
    });
    expect(result).toEqual({
      type: "changed",
      entity: "vault",
      changes: ["files-changed"],
    });
  });

  it("parses the hello ack frame", () => {
    const result = serverMessageLenientSchema.parse({ type: "hello" });
    expect(result).toEqual({ type: "hello" });
  });
});
