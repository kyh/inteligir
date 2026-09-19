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
      changes: ["content-changed", "not-a-kind"],
      entity: "doc",
      id: "d1",
      type: "changed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown field", () => {
    const result = changedMessageSchema.safeParse({
      changes: ["files-changed"],
      entity: "vault",
      extra: true,
      type: "changed",
    });
    expect(result.success).toBe(false);
  });

  it("requires an id on doc messages", () => {
    const result = changedMessageSchema.safeParse({
      changes: ["content-changed"],
      entity: "doc",
      type: "changed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a subscribe message with an extra target field", () => {
    const result = clientMessageSchema.safeParse({
      target: { extra: 1, kind: "vault" },
      type: "subscribe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a subscribe message with an extra top-level field", () => {
    const result = clientMessageSchema.safeParse({
      extra: 1,
      target: { kind: "vault" },
      type: "subscribe",
    });
    expect(result.success).toBe(false);
  });
});

describe("lenient inbound schemas", () => {
  it("filters unknown change kinds instead of rejecting the message", () => {
    const result = changedMessageLenientSchema.parse({
      changes: ["events-appended", "some-future-kind"],
      entity: "thread",
      id: "t1",
      type: "changed",
    });
    expect(result.changes).toEqual(["events-appended"]);
  });

  it("strips unknown fields instead of rejecting the message", () => {
    const result = changedMessageLenientSchema.parse({
      changes: ["files-changed"],
      entity: "vault",
      futureField: { nested: true },
      type: "changed",
    });
    expect(result).toEqual({
      changes: ["files-changed"],
      entity: "vault",
      type: "changed",
    });
  });

  it("parses the hello ack frame", () => {
    const result = serverMessageLenientSchema.parse({ type: "hello" });
    expect(result).toEqual({ type: "hello" });
  });
});
