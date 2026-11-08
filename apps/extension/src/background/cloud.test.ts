import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { failureOf, FileRefusedError } from "./cloud";

describe("what a failed call means for its save", () => {
  it("is a sign-in ended for a session the cloud no longer holds", () => {
    expect(failureOf(new ORPCError("UNAUTHORIZED"))).toStrictEqual({ kind: "signed-out" });
    expect(failureOf(new FileRefusedError(401))).toStrictEqual({ kind: "signed-out" });
  });

  it("is an account gone for one the cloud deleted, which no sign-in brings back", () => {
    expect(failureOf(new ORPCError("GONE"))).toStrictEqual({ kind: "gone" });
    expect(failureOf(new FileRefusedError(410))).toStrictEqual({ kind: "gone" });
  });

  it("is a refusal in the person's words where they can act on it", () => {
    expect(failureOf(new ORPCError("CLIENT_OUTDATED"))).toStrictEqual({
      kind: "refused",
      reason: "update-extension",
    });
    expect(failureOf(new ORPCError("QUOTA"))).toStrictEqual({
      kind: "refused",
      reason: "library-full",
    });
    expect(failureOf(new FileRefusedError(413))).toStrictEqual({
      kind: "refused",
      reason: "too-large",
    });
    expect(failureOf(new ORPCError("BAD_REQUEST"))).toStrictEqual({
      kind: "refused",
      reason: "failed",
    });
  });

  it("waits to be sent again when the cloud never answered, or answered a fault of its own", () => {
    expect(failureOf(new TypeError("Failed to fetch"))).toStrictEqual({ kind: "unanswered" });
    expect(failureOf(new DOMException("The operation timed out.", "TimeoutError"))).toStrictEqual({
      kind: "unanswered",
    });
    expect(failureOf(new ORPCError("INTERNAL_SERVER_ERROR"))).toStrictEqual({ kind: "unanswered" });
    expect(failureOf(new ORPCError("TOO_MANY_REQUESTS"))).toStrictEqual({
      kind: "unanswered",
    });
    expect(failureOf(new FileRefusedError(503))).toStrictEqual({ kind: "unanswered" });
  });
});
