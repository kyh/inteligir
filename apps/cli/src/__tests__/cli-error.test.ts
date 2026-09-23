import { describe, expect, it } from "vitest";
import { CliExitError, getErrorMessage, isUnreachable } from "../cli-error";

const errnoError = (code: string): Error =>
  Object.assign(new Error(`connect ${code} 127.0.0.1:4664`), { code });

describe("getErrorMessage", () => {
  it("reads a fetch failure's socket error out of its cause", () => {
    const failure = new TypeError("fetch failed", { cause: errnoError("ECONNREFUSED") });
    expect(getErrorMessage(failure)).toBe("fetch failed: connect ECONNREFUSED 127.0.0.1:4664");
  });

  it("reads a cause before an AggregateError's children, each child's own cause after it", () => {
    const dial = new AggregateError(
      [new Error("a", { cause: new Error("a-cause") }), new Error("b")],
      "dial",
      { cause: new Error("dial-cause") },
    );
    expect(getErrorMessage(dial)).toBe("dial: dial-cause: a: a-cause: b");
  });

  it("walks a cycle once", () => {
    const first = new Error("first");
    first.cause = new Error("second", { cause: first });
    expect(getErrorMessage(first)).toBe("first: second");
  });

  it("skips an empty message rather than printing a bare separator", () => {
    const failure = new TypeError("fetch failed", {
      // oxlint-disable-next-line unicorn/error-message -- node's multi-address dial raises exactly this
      cause: new AggregateError([errnoError("ECONNREFUSED")], ""),
    });
    expect(getErrorMessage(failure)).toBe("fetch failed: connect ECONNREFUSED 127.0.0.1:4664");
  });

  it("spells a thrown non-Error as itself", () => {
    expect(getErrorMessage("plain")).toBe("plain");
  });
});

describe("isUnreachable", () => {
  it("finds a refused dial under an AggregateError inside the cause", () => {
    const failure = new TypeError("fetch failed", {
      cause: new AggregateError([new Error("v6"), errnoError("ECONNREFUSED")], "dial"),
    });
    expect(isUnreachable(failure)).toBe(true);
  });

  it("is false for an errno that is not a dial failure, and for a non-Error", () => {
    expect(isUnreachable(new Error("denied", { cause: errnoError("EACCES") }))).toBe(false);
    expect(isUnreachable("ECONNREFUSED")).toBe(false);
  });
});

describe("CliExitError", () => {
  it("exits with the code its class carries", () => {
    expect(new CliExitError("x", { code: "INVALID_USAGE" }).exitCode).toBe(1);
    expect(new CliExitError("x", { code: "WAIT_TIMEOUT" }).exitCode).toBe(2);
    expect(new CliExitError("x", { code: "SERVER_UNREACHABLE" }).exitCode).toBe(3);
    expect(new CliExitError("x", { code: "AWAITING_INTERACTION" }).exitCode).toBe(4);
    expect(new CliExitError("x", { code: "INTERRUPTED" }).exitCode).toBe(130);
  });

  it("keeps a server's class it re-raises, and exits as that refusal would", () => {
    const failure = new CliExitError("x", { serverClass: "PROVIDER_UNAVAILABLE" });
    expect(failure.code).toBe("PROVIDER_UNAVAILABLE");
    expect(failure.exitCode).toBe(1);
  });
});
