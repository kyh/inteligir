import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { HARNESSES } from "../harness-registry";
import { describeProviderError, readProviderError } from "../provider-error";

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

describe("readProviderError", () => {
  it("reads claude's authentication_failed as signed out, whatever the code", () => {
    const refused = RequestError.internalError({ errorKind: "authentication_failed" }, "401");
    expect(readProviderError(refused, HARNESSES.claude)).toEqual({
      failure: "auth",
      message: "Claude is signed out on this Mac.",
    });
    expect(readProviderError(RequestError.authRequired(), HARNESSES.claude).failure).toBe("auth");
  });

  it("reads a plan's usage limit from either adapter, in the person's words", () => {
    const claude = RequestError.internalError({ errorKind: "rate_limit" });
    expect(readProviderError(claude, HARNESSES.claude)).toEqual({
      failure: "usage-limit",
      message:
        "Claude says you've reached your plan's usage limit. Your queued messages will wait until you send again.",
    });
    const codex = RequestError.internalError({
      codexErrorInfo: "usageLimitExceeded",
      message: "You've hit your usage limit.",
    });
    expect(readProviderError(codex, HARNESSES.codex)).toEqual({
      failure: "usage-limit",
      message:
        "ChatGPT says you've reached your plan's usage limit. Your queued messages will wait until you send again.",
    });
    const codex429 = RequestError.internalError({
      codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 429 } },
    });
    expect(readProviderError(codex429).failure).toBe("usage-limit");
  });

  it("reads claude's limit by its own text when no errorKind came with it", () => {
    const refused = RequestError.internalError(undefined, "You've hit your limit · resets 3pm");
    expect(readProviderError(refused).failure).toBe("usage-limit");
  });

  it("classes overload and context, and keeps the adapter's words for them", () => {
    const overloaded = RequestError.internalError({ errorKind: "overloaded" }, "Overloaded");
    expect(readProviderError(overloaded, HARNESSES.claude)).toEqual({
      failure: "overloaded",
      message: "Internal error: Overloaded",
    });
    const context = RequestError.internalError({ codexErrorInfo: "contextWindowExceeded" });
    expect(readProviderError(context, HARNESSES.codex).failure).toBe("context");
  });

  it("reads anything it does not know as other, never a throw", () => {
    expect(readProviderError(RequestError.internalError({ errorKind: "no_result" })).failure).toBe(
      "other",
    );
    expect(readProviderError(RequestError.internalError("not an object")).failure).toBe("other");
    expect(readProviderError(new Error("stdout closed"))).toEqual({
      failure: "other",
      message: "stdout closed",
    });
  });
});
