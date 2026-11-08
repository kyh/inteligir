import type { V1Transport } from "@repo/contract/cloud/library/call-outcome";
import { PHONE_ORIGIN } from "@repo/contract/cloud/origin";
import { describe, expect, it } from "vitest";
import { downloadBlob, phoneTransport } from "./phone-transport";

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

// what the phone's fetch was handed for one request, sent while the phone keeps `cookie`
const sentWith = async (cookie: string | null): Promise<Request> => {
  const sent: Request[] = [];
  const transport = phoneTransport({
    build: { platform: "mobile", version: "1.2.3" },
    cookie: async () => await Promise.resolve(cookie),
    fetch: async (request) => {
      sent.push(request);
      return await Promise.resolve(new Response(null, { status: 204 }));
    },
    origin: "https://cloud.test",
  });
  await transport.fetch(new Request("https://cloud.test/v1/rpc/account/socketTicket"));
  const [request] = sent;
  if (request === undefined) {
    throw new Error("the transport sent nothing");
  }
  return request;
};

describe("a request to the cloud", () => {
  it("carries the build and the kept session, under the app's scheme, and no cookie of the system's", async () => {
    const request = await sentWith("better-auth.session_token=signed");
    expect(Object.fromEntries(request.headers)).toStrictEqual({
      cookie: "better-auth.session_token=signed",
      "expo-origin": PHONE_ORIGIN,
      "x-inteligir-build": "1.2.3+mobile",
    });
    expect(request.credentials).toBe("omit");
  });

  it("carries no cookie while the phone keeps no session", async () => {
    const request = await sentWith(null);
    expect(request.headers.has("cookie")).toBe(false);
  });
});
