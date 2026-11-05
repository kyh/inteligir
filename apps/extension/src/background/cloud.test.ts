import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { failureOf, FileRefusedError } from "./cloud";

describe("what a failed call means for its save", () => {
  it("is a connection ended for a revoked credential or a deleted account", () => {
    expect(failureOf(new ORPCError("UNAUTHORIZED"))).toEqual({ kind: "signed-out" });
    expect(failureOf(new ORPCError("GONE"))).toEqual({ kind: "signed-out" });
    expect(failureOf(new FileRefusedError(401))).toEqual({ kind: "signed-out" });
  });

  it("is a refusal in the person's words where they can act on it", () => {
    expect(failureOf(new ORPCError("CLIENT_OUTDATED"))).toEqual({
      kind: "refused",
      reason: "update-extension",
    });
    expect(failureOf(new ORPCError("QUOTA"))).toEqual({
      kind: "refused",
      reason: "library-full",
    });
    expect(failureOf(new FileRefusedError(413))).toEqual({ kind: "refused", reason: "too-large" });
    expect(failureOf(new ORPCError("BAD_REQUEST"))).toEqual({ kind: "refused", reason: "failed" });
  });

  it("waits to be sent again when the cloud never answered, or answered a fault of its own", () => {
    expect(failureOf(new TypeError("Failed to fetch"))).toEqual({ kind: "unanswered" });
    expect(failureOf(new DOMException("The operation timed out.", "TimeoutError"))).toEqual({
      kind: "unanswered",
    });
    expect(failureOf(new ORPCError("INTERNAL_SERVER_ERROR"))).toEqual({ kind: "unanswered" });
    expect(failureOf(new ORPCError("TOO_MANY_REQUESTS"))).toEqual({
      kind: "unanswered",
    });
    expect(failureOf(new FileRefusedError(503))).toEqual({ kind: "unanswered" });
  });
});
