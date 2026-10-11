import { describe, expect, it } from "vitest";
import { providerFailureMessage, QUEUE_HOLDING_FAILURES } from "../provider-failure";

describe("providerFailureMessage", () => {
  it("names the harness a sign-in refused", () => {
    expect(providerFailureMessage("auth", "claude", "Authentication required")).toBe(
      "Claude is signed out on this Mac.",
    );
    expect(providerFailureMessage("auth", "codex", "Said")).toBe(
      "ChatGPT is signed out on this Mac.",
    );
  });

  it("says the plan's limit, and that the queue waits", () => {
    expect(providerFailureMessage("usage-limit", "claude", "Internal error")).toBe(
      "Claude says you've reached your plan's usage limit. Your queued messages will wait until you send again.",
    );
    expect(providerFailureMessage("usage-limit", "codex", "Said")).toBe(
      "ChatGPT says you've reached your plan's usage limit. Your queued messages will wait until you send again.",
    );
  });

  it("keeps the adapter's words for a class the queue drains past", () => {
    for (const failure of ["overloaded", "context", "other"] as const) {
      expect(QUEUE_HOLDING_FAILURES.has(failure)).toBe(false);
      expect(providerFailureMessage(failure, "claude", "Internal error: Overloaded")).toBe(
        "Internal error: Overloaded",
      );
    }
  });
});
