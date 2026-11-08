import type { SessionEnd } from "@repo/contract/cloud/library/call-outcome";
import { describe, expect, it } from "vitest";

import { FileRefusedError, uploadFile } from "./library-files";
import type { FileCloud } from "./library-files";

const answering = (status: number) => {
  const ended: SessionEnd[] = [];
  const cloud: FileCloud = {
    fetch: async () => await Promise.resolve(new Response(null, { status })),
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
    [401, "signed-out"],
    [410, "gone"],
    [426, "outdated"],
  ] as const)("ends the page's session on a %i, as the wire's calls do", async (status, end) => {
    const { cloud, ended } = answering(status);
    await expect(upload(cloud)).rejects.toThrow("the file was not sent: session");
    expect(ended).toStrictEqual([end]);
  });

  it("ends nothing on a refusal of the file or a fault of the cloud's", async () => {
    const full = answering(507);
    await expect(upload(full.cloud)).rejects.toBeInstanceOf(FileRefusedError);
    const busy = answering(503);
    await expect(upload(busy.cloud)).rejects.toThrow("the file was not sent: unreachable");
    expect([...full.ended, ...busy.ended]).toStrictEqual([]);
  });
});
