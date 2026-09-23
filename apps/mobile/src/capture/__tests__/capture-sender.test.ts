import type { CaptureRequest, CaptureResponse } from "@repo/api/cloud/captures/captures-schema";
import type { CloudResult } from "@repo/api/cloud/client";
import { describe, expect, it } from "vitest";
import { createCaptureSender } from "../capture-sender";

const UNREACHABLE: CloudResult<CaptureResponse> = {
  failure: { kind: "unreachable", message: "offline" },
  ok: false,
};

const stored = (duplicate: boolean): CloudResult<CaptureResponse> => ({
  ok: true,
  value: { createdAt: 0, duplicate, id: "cap_1" },
});

const harness = (answers: CloudResult<CaptureResponse>[]) => {
  const sent: CaptureRequest[] = [];
  let minted = 0;
  const send = createCaptureSender({
    mintKey: () => {
      minted += 1;
      return `key-${minted}`;
    },
    send: async (request) => {
      sent.push(request);
      return answers.shift() ?? stored(false);
    },
  });
  return { send, sent };
};

describe("the capture sender", () => {
  it("retries the same words under the same key, so a lost response cannot duplicate them", async () => {
    const { send, sent } = harness([UNREACHABLE, stored(true)]);
    const lost = await send("buy milk");
    const retried = await send("buy milk");
    expect([lost.ok, retried.ok]).toEqual([false, true]);
    expect(sent.map((request) => request.idempotencyKey)).toEqual(["key-1", "key-1"]);
  });

  it("gives edited words a new key — they are a different capture", async () => {
    const { send, sent } = harness([UNREACHABLE]);
    await send("buy milk");
    await send("buy oat milk");
    expect(sent.map((request) => request.idempotencyKey)).toEqual(["key-1", "key-2"]);
  });

  it("forgets the key once the cloud holds the words, so sending them again is a new capture", async () => {
    const { send, sent } = harness([stored(false)]);
    await send("buy milk");
    await send("buy milk");
    expect(sent.map((request) => request.idempotencyKey)).toEqual(["key-1", "key-2"]);
  });
});
