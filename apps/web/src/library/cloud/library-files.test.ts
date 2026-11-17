import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { refusalResponse } from "@repo/contract/test-support/refusal-response";
import {
  AccountGoneError,
  ClientOutdatedError,
  QuotaError,
  UnauthorizedError,
} from "@repo/contract/rpc/v1-errors";
import { describe, expect, it } from "vitest";

import { uploadFile } from "./library-files";
import type { FileCloud } from "./library-files";

const answering = (answer: () => Response) => {
  const ended: SessionEnd[] = [];
  const cloud: FileCloud = {
    fetch: async () => await Promise.resolve(answer()),
    onSessionEnd: (end) => {
      ended.push(end);
    },
    origin: "https://library.test",
  };
  return { cloud, ended };
};

const upload = async (cloud: FileCloud): Promise<string> =>
  await uploadFile(cloud, new Uint8Array([1, 2, 3]), "image/png");

describe("a file sent up from the page", () => {
  it.each([
    ["signed-out", new UnauthorizedError()],
    ["gone", new AccountGoneError()],
    ["outdated", new ClientOutdatedError()],
  ] as const)(
    "ends the page's session as %s on the refusal that says so, as the wire's calls do",
    async (end, refusal) => {
      const { cloud, ended } = answering(() => refusalResponse(refusal));
      await expect(upload(cloud)).rejects.toMatchObject({ code: refusal.code, defined: true });
      expect(ended).toStrictEqual([end]);
    },
  );

  it("ends nothing on a refusal of the file or a fault of the cloud's, and a refusal says why", async () => {
    const full = answering(() =>
      refusalResponse(new QuotaError({ data: { bytesCap: 1, bytesUsed: 1 } })),
    );
    await expect(upload(full.cloud)).rejects.toMatchObject({
      code: "QUOTA",
      defined: true,
      message: "Your library is full.",
    });
    const down = answering(() => new Response(null, { status: 503 }));
    await expect(upload(down.cloud)).rejects.toThrow("the cloud answered 503");
    expect([...full.ended, ...down.ended]).toStrictEqual([]);
  });
});
