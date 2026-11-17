import { createORPCErrorFromJson } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { refusalResponse } from "../test-support/refusal-response";
import {
  AccountGoneError,
  BlobMismatchError,
  ClientOutdatedError,
  PayloadTooLargeError,
  QuotaError,
  TooManyRequestsError,
} from "../v1-errors";
import { outcomeOf, sessionEndOf, sharedFailure, uploadBlob } from "./call-outcome";
import type { CallOutcome, SessionEnd, V1Transport } from "./call-outcome";

const CHANGE_REFUSED = "Your library couldn't take this change.";

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

  it("reads a file's upload as any call, the sha its answer", async () => {
    const sent = async (answer: (() => Response) | null) =>
      await outcomeOf(async () => {
        await uploadBlob(answering(answer), FILE);
        return FILE.sha;
      });
    await expect(sent(() => new Response(null, { status: 201 }))).resolves.toStrictEqual({
      answer: FILE.sha,
      kind: "landed",
    });
    await expect(
      sent(() => refusalResponse(new QuotaError({ data: { bytesCap: 10, bytesUsed: 10 } }))),
    ).resolves.toStrictEqual({ code: "QUOTA", kind: "refused", message: "Your library is full." });
    await expect(sent(() => refusalResponse(new AccountGoneError()))).resolves.toStrictEqual({
      kind: "gone",
    });
    await expect(sent(() => refusalResponse(new TooManyRequestsError()))).resolves.toStrictEqual(
      WAITS_FOR_CONNECTION,
    );
    await expect(sent(null)).resolves.toStrictEqual(WAITS_FOR_CONNECTION);
  });
});
