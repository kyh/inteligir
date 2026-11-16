import { createORPCErrorFromJson } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { outcomeOf, sessionEndOf, UNREACHABLE, uploadBlob, uploaded } from "./call-outcome";
import type { CallOutcome, UploadOutcome, V1Transport } from "./call-outcome";

const CHANGE_REFUSED = "Your library couldn't take this change.";

const FILE = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", sha: "a".repeat(64) };

// a cloud that answers every upload with one status, or throws as a fetch with no connection does
const answering = (status: number | null): V1Transport => ({
  fetch: async () => {
    if (status === null) {
      throw new TypeError("Failed to fetch");
    }
    return new Response(null, { status });
  },
  origin: "http://localhost:5174",
});

describe(uploadBlob, () => {
  it("names each refusal by the code the call answers its status with, beside its words", async () => {
    const refusals = new Map<number, UploadOutcome>([
      [
        400,
        {
          code: "BAD_REQUEST",
          kind: "refused",
          reason: "This file changed on this device before it was sent.",
        },
      ],
      [
        413,
        {
          code: "PAYLOAD_TOO_LARGE",
          kind: "refused",
          reason: "This file is larger than your library keeps.",
        },
      ],
      [507, { code: "QUOTA", kind: "refused", reason: "Your library is full." }],
    ]);
    for (const [status, outcome] of refusals) {
      await expect(uploadBlob(answering(status), FILE), String(status)).resolves.toStrictEqual(
        outcome,
      );
    }
  });

  it("is stored, or a failure every call shares", async () => {
    await expect(uploadBlob(answering(201), FILE)).resolves.toStrictEqual({ kind: "stored" });
    await expect(uploadBlob(answering(426), FILE)).resolves.toStrictEqual({
      failure: { end: "outdated", kind: "session" },
      kind: "failed",
    });
    for (const status of [503, null]) {
      await expect(uploadBlob(answering(status), FILE), String(status)).resolves.toStrictEqual({
        failure: { kind: "unreachable", message: UNREACHABLE },
        kind: "failed",
      });
    }
  });
});

const defined = (code: string, message = code) =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message });
const undeclared = (code: string) =>
  createORPCErrorFromJson({ code, data: undefined, defined: false, message: code });

describe(sessionEndOf, () => {
  it("ends the sign-in on a signed-out, deleted or outdated one, and on nothing else", () => {
    expect(sessionEndOf(defined("UNAUTHORIZED"))).toBe("signed-out");
    expect(sessionEndOf(defined("GONE"))).toBe("gone");
    expect(sessionEndOf(defined("CLIENT_OUTDATED"))).toBe("outdated");
    expect(sessionEndOf(defined("INVALID_CREDENTIALS"))).toBeNull();
    expect(sessionEndOf(new Error("offline"))).toBeNull();
  });
});

const WAITS_FOR_CONNECTION = { for: "connection", kind: "wait" } as const;

describe(outcomeOf, () => {
  it("answers what the call did", async () => {
    await expect(outcomeOf(async () => "the answer")).resolves.toStrictEqual({
      answer: "the answer",
      kind: "landed",
    });
  });

  it("reads every miss one way: a later try may pass, no resend does, or the account is gone", async () => {
    const misses: readonly (readonly [string, unknown, CallOutcome<never>])[] = [
      ["a session the cloud ended", defined("UNAUTHORIZED"), { for: "sign-in", kind: "wait" }],
      ["a build too old", defined("CLIENT_OUTDATED"), { for: "update", kind: "wait" }],
      ["the cloud's budget", defined("TOO_MANY_REQUESTS"), WAITS_FOR_CONNECTION],
      ["no connection", new TypeError("Failed to fetch"), WAITS_FOR_CONNECTION],
      ["the call's deadline", new DOMException("timed out", "TimeoutError"), WAITS_FOR_CONNECTION],
      ["a fault of the cloud's", undeclared("INTERNAL_SERVER_ERROR"), WAITS_FOR_CONNECTION],
      ["a throw that is no error", "offline", WAITS_FOR_CONNECTION],
      ["the account deleted", defined("GONE"), { kind: "gone" }],
      [
        "a refusal of the call's own, in its words",
        defined("QUOTA", "Your library is full."),
        { code: "QUOTA", kind: "refused", message: "Your library is full." },
      ],
      [
        "a refusal that says nothing",
        defined("CONFLICT", ""),
        { code: "CONFLICT", kind: "refused", message: CHANGE_REFUSED },
      ],
      [
        "input the cloud refused",
        undeclared("BAD_REQUEST"),
        { code: "BAD_REQUEST", kind: "refused", message: CHANGE_REFUSED },
      ],
    ];
    for (const [met, thrown, outcome] of misses) {
      await expect(
        outcomeOf(async () => {
          throw thrown;
        }),
        met,
      ).resolves.toStrictEqual(outcome);
    }
  });
});

describe(uploaded, () => {
  it("reads a file's upload as a call's outcome, the sha its answer", () => {
    const sha = "a".repeat(64);
    expect(uploaded({ kind: "stored" }, sha)).toStrictEqual({ answer: sha, kind: "landed" });
    expect(
      uploaded({ code: "QUOTA", kind: "refused", reason: "Your library is full." }, sha),
    ).toStrictEqual({ code: "QUOTA", kind: "refused", message: "Your library is full." });
    expect(
      uploaded({ failure: { end: "gone", kind: "session" }, kind: "failed" }, sha),
    ).toStrictEqual({ kind: "gone" });
    expect(uploaded({ failure: { kind: "busy" }, kind: "failed" }, sha)).toStrictEqual(
      WAITS_FOR_CONNECTION,
    );
  });
});
