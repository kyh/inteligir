import type { V1Transport } from "@repo/contract/cloud/library/call-outcome";
import { describe, expect, it } from "vitest";
import { downloadBlob } from "./phone-transport";

const SHA = "a".repeat(64);
const CLIP = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);

// the cloud's answer to every request, and the paths asked
const answering = (response: () => Response) => {
  const asked: string[] = [];
  const transport: V1Transport = {
    fetch: async (request) => {
      asked.push(new URL(request.url).pathname);
      return await Promise.resolve(response());
    },
    origin: "https://cloud.test",
  };
  return { asked, transport };
};

// a hash that names the bytes `SHA`, or another file
const hashing = (sha: string) => async () => await Promise.resolve(sha);

describe("a file fetched from the cloud", () => {
  it("comes with the type the cloud serves it as", async () => {
    const { asked, transport } = answering(
      () => new Response(CLIP, { headers: { "content-type": "video/mp4" } }),
    );
    await expect(downloadBlob(transport, hashing(SHA), SHA)).resolves.toStrictEqual({
      bytes: CLIP,
      mime: "video/mp4",
    });
    expect(asked).toStrictEqual([`/v1/blobs/${SHA}`]);
  });

  it("comes as plain bytes when the cloud names no type", async () => {
    const { transport } = answering(() => new Response(CLIP));
    await expect(downloadBlob(transport, hashing(SHA), SHA)).resolves.toMatchObject({
      mime: "application/octet-stream",
    });
  });

  it("is none when the cloud holds none, and refused when it came changed", async () => {
    const missing = answering(() => new Response(null, { status: 404 }));
    await expect(downloadBlob(missing.transport, hashing(SHA), SHA)).resolves.toBeNull();
    const changed = answering(() => new Response(CLIP));
    await expect(downloadBlob(changed.transport, hashing("b".repeat(64)), SHA)).rejects.toThrow(
      /changed on the way/u,
    );
  });
});
