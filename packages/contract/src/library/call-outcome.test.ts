import { createORPCErrorFromJson } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { sessionEndOf, UNREACHABLE, uploadBlob } from "./call-outcome";
import type { UploadOutcome, V1Transport } from "./call-outcome";

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

const defined = (code: string) =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message: code });

describe(sessionEndOf, () => {
  it("ends the sign-in on a signed-out, deleted or outdated one, and on nothing else", () => {
    expect(sessionEndOf(defined("UNAUTHORIZED"))).toBe("signed-out");
    expect(sessionEndOf(defined("GONE"))).toBe("gone");
    expect(sessionEndOf(defined("CLIENT_OUTDATED"))).toBe("outdated");
    expect(sessionEndOf(defined("INVALID_CREDENTIALS"))).toBeNull();
    expect(sessionEndOf(new Error("offline"))).toBeNull();
  });
});
