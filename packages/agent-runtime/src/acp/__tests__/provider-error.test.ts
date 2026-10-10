import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { HARNESSES, VaultConfigRefusedError } from "../harness-registry";
import { describeProviderError, readProviderError, readSessionFailure } from "../provider-error";

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

  it("reads claude's plan usage limit in the person's words", () => {
    const refused = RequestError.internalError({ errorKind: "rate_limit" });
    expect(readProviderError(refused, HARNESSES.claude)).toEqual({
      failure: "usage-limit",
      message:
        "Claude says you've reached your plan's usage limit. Your queued messages will wait until you send again.",
    });
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
    const context = RequestError.internalError({ errorKind: "max_output_tokens" }, "Too long");
    expect(readProviderError(context, HARNESSES.claude).failure).toBe("context");
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

  it("reads a vault holding the vendor's settings as other, so the queue behind it drains", () => {
    const refused = new VaultConfigRefusedError(HARNESSES.codex, ".codex");
    expect(readProviderError(refused, HARNESSES.codex)).toEqual({
      failure: "other",
      message: refused.message,
    });
  });
});

// a prompt answer's `_meta` as codex-acp attaches a typed failure, its category and actions one row
// of the adapter's own failure policy.
const answerMeta = (category: string, actions: readonly string[], severity = "error") => ({
  jetbrains: {
    air: {
      sessionFailure: { actions, category, id: "turn:error", revision: 1, severity, title: "Said" },
      version: 1,
    },
  },
  quota: { model_usage: [], token_count: null },
});

describe("readSessionFailure", () => {
  it("reads codex's access failure as signed out", () => {
    expect(readSessionFailure(answerMeta("access", ["login"]), HARNESSES.codex)).toEqual({
      failure: "auth",
      message: "ChatGPT is signed out on this Mac.",
    });
  });

  it("reads a limit a new session clears as the context, any other as the plan's", () => {
    expect(readSessionFailure(answerMeta("limit", ["new_session"]), HARNESSES.codex)).toEqual({
      failure: "context",
      message: "Said",
    });
    for (const actions of [[], ["retry"]]) {
      expect(readSessionFailure(answerMeta("limit", actions), HARNESSES.codex)).toEqual({
        failure: "usage-limit",
        message:
          "ChatGPT says you've reached your plan's usage limit. Your queued messages will wait until you send again.",
      });
    }
  });

  it("reads a service or connection failure as other, in codex's words", () => {
    for (const category of ["service", "connection", "request"]) {
      expect(readSessionFailure(answerMeta(category, ["retry"]), HARNESSES.codex)).toEqual({
        failure: "other",
        message: "Said",
      });
    }
  });

  it("reads no failure from a warning the turn got past, or an answer carrying none", () => {
    expect(readSessionFailure(answerMeta("connection", [], "warning"))).toBeNull();
    expect(readSessionFailure({ quota: { model_usage: [], token_count: null } })).toBeNull();
    expect(readSessionFailure(null)).toBeNull();
  });
});
