import { RequestError } from "@zed-industries/agent-client-protocol";
import { describe, expect, it } from "vitest";
import { HARNESSES } from "../harness-registry";
import { acpCall, describeProviderError } from "../provider-error";

const WIRE_AUTH_REQUIRED = { code: -32_000, message: "Authentication required" };

describe("acpCall", () => {
  it("rebuilds the bare JSON-RPC error object a request rejects with as a RequestError", async () => {
    const call = acpCall(Promise.reject(WIRE_AUTH_REQUIRED));
    await expect(call).rejects.toBeInstanceOf(RequestError);
    await expect(call).rejects.toMatchObject({ code: -32_000, message: "Authentication required" });
  });

  it("passes an Error and an unrecognised value through untouched", async () => {
    const error = new Error("stdout closed");
    const unrecognised = { reason: "stdout closed" };
    await expect(acpCall(Promise.reject(error))).rejects.toBe(error);
    await expect(acpCall(Promise.reject(unrecognised))).rejects.toBe(unrecognised);
  });

  it("resolves with the response", async () => {
    await expect(acpCall(Promise.resolve({ sessionId: "s_1" }))).resolves.toEqual({
      sessionId: "s_1",
    });
  });
});

describe("describeProviderError", () => {
  it("names the harness's login command for an auth refusal", () => {
    expect(describeProviderError(RequestError.authRequired(), HARNESSES.claude)).toBe(
      "Claude Code is not signed in — run: claude /login",
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
