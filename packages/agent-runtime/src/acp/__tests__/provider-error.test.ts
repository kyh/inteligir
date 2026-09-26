import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { HARNESSES } from "../harness-registry";
import { describeProviderError } from "../provider-error";

const WIRE_AUTH_REQUIRED = { code: -32_000, message: "Authentication required" };

describe("describeProviderError", () => {
  it("names the harness for an auth refusal", () => {
    expect(describeProviderError(RequestError.authRequired(), HARNESSES.claude)).toBe(
      "Claude is signed out on this Mac.",
    );
  });

  it("reads the adapter's own message without a harness, or for any other code", () => {
    expect(describeProviderError(RequestError.authRequired())).toBe("Authentication required");
    expect(describeProviderError(WIRE_AUTH_REQUIRED)).toBe("Authentication required");
    expect(
      describeProviderError(RequestError.internalError({ details: "boom" }), HARNESSES.codex),
    ).toBe("Internal error");
  });

  it("never prints an object as [object Object]", () => {
    expect(describeProviderError(new Error("stdout closed"))).toBe("stdout closed");
    expect(describeProviderError("gone")).toBe("gone");
  });
});
