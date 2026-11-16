import { createORPCErrorFromJson } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { refusalResponse } from "../test-support/refusal-response";
import {
  BlobMismatchError,
  ClientOutdatedError,
  PayloadTooLargeError,
  QuotaError,
} from "../v1-errors";
import { sessionEndOf, sharedFailure, uploadBlob } from "./call-outcome";
import type { SessionEnd, V1Transport } from "./call-outcome";

const FILE = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", sha: "a".repeat(64) };

// a cloud that answers every upload one way, or throws as a fetch with no connection does
const answering = (answer: (() => Response) | null): V1Transport => ({
  fetch: async () => {
    if (answer === null) {
      throw new TypeError("Failed to fetch");
    }
    return await Promise.resolve(answer());
  },
  origin: "http://localhost:5174",
});

describe(uploadBlob, () => {
  it("lands on any answer that kept the file", async () => {
    for (const status of [201, 204]) {
      const kept = answering(() => new Response(null, { status }));
      await expect(uploadBlob(kept, FILE)).resolves.toBeUndefined();
    }
  });

  it("throws the refusal the cloud declared, as a call's link does", async () => {
    for (const refusal of [
      new BlobMismatchError(),
      new PayloadTooLargeError({ message: "This file is larger than your library keeps." }),
      new QuotaError({ data: { bytesCap: 10, bytesUsed: 10 } }),
    ]) {
      const refused = answering(() => refusalResponse(refusal));
      await expect(uploadBlob(refused, FILE), refusal.code).rejects.toMatchObject({
        code: refusal.code,
        data: refusal.data,
        defined: true,
        message: refusal.message,
      });
    }
  });

  it("tells the hook a sign-in it ended, and reads a fault or no answer as no refusal", async () => {
    const ended: SessionEnd[] = [];
    const outdated = answering(() => refusalResponse(new ClientOutdatedError()));
    await expect(
      uploadBlob(outdated, FILE, (end) => {
        ended.push(end);
      }),
    ).rejects.toMatchObject({ code: "CLIENT_OUTDATED", defined: true });
    expect(ended).toStrictEqual(["outdated"]);
    for (const answer of [
      () => new Response("Send the file again.", { status: 503 }),
      () => Response.json(null, { status: 500 }),
      null,
    ]) {
      await expect(uploadBlob(answering(answer), FILE)).rejects.toSatisfy(
        (thrown: Error) => sharedFailure(thrown)?.kind === "unreachable",
      );
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
