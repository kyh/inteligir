import { fileSha } from "@repo/contract/library/file-sha";
import { sharedFailure } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { refusalResponse } from "@repo/contract/test-support/refusal-response.test-utils";
import {
  AccountGoneError,
  ClientOutdatedError,
  QuotaError,
  UnauthorizedError,
} from "@repo/contract/rpc/v1-errors";
import { describe, expect, it } from "vitest";

import { uploadFile } from "./library-files";
import type { FileCloud } from "./library-files";

const pageCloud = (transport: V1Transport) => {
  const ended: SessionEnd[] = [];

  const cloud: FileCloud = {
    ...transport,
    onSessionEnd: (end) => {
      ended.push(end);
    },
  };

  return { cloud, ended };
};

const answering = (answer: () => Response) =>
  pageCloud({
    fetch: async () => await Promise.resolve(answer()),
    origin: "https://library.test",
  });

const upload = async (cloud: FileCloud) =>
  await uploadFile(cloud, new Uint8Array([1, 2, 3]), "image/png");

describe("a file sent up from the page", () => {
  it("goes under the sha every other host spells for its bytes", async () => {
    const cell = createFakeCell();
    const { cloud } = pageCloud(cell.device("page").transport);
    const bytes = Uint8Array.from({ length: 1024 * 1024 + 7 }, (_, at) => (at * 31) % 251);
    await expect(uploadFile(cloud, bytes, "image/png")).resolves.toBe(fileSha(bytes));
    expect(cell.uploads).toStrictEqual([fileSha(bytes)]);
  });

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
    await expect(upload(down.cloud)).rejects.toSatisfy(
      (thrown: Error) => sharedFailure(thrown)?.kind === "unreachable",
    );
    expect([...full.ended, ...down.ended]).toStrictEqual([]);
  });
});
