import { fileSha } from "@repo/contract/library/file-sha";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cloudOf, sendFile } from "./cloud";
import { SESSION } from "./test-support/fake-cloud";

afterEach(() => {
  vi.unstubAllGlobals();
});

// the cloud: every request recorded, a file's bytes stored, and every call answered as `answer` says
const cloudAnswering = (answer: (request: Request) => Response) => {
  const asked: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      asked.push(request);
      return answer(request);
    }),
  );
  return asked;
};

describe("the extension's calls to its cloud", () => {
  it("send a file's bytes by their SHA-256, under the session's bearer and this build, to a deadline", async () => {
    const asked = cloudAnswering(() => new Response(null, { status: 201 }));
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(sendFile(cloudOf(SESSION, "0.6.0"), bytes, "image/png")).resolves.toStrictEqual({
      answer: fileSha(bytes),
      kind: "landed",
    });
    const [put] = asked;
    expect(put?.method).toBe("PUT");
    expect(put?.url).toBe(`${SESSION.origin}/v1/blobs/${fileSha(bytes)}`);
    expect(put?.headers.get("authorization")).toBe(`Bearer ${SESSION.bearer}`);
    expect(put?.headers.get("x-inteligir-build")).toBe("0.6.0+extension");
    expect(put?.headers.get("content-type")).toBe("image/png");
    expect(put?.signal.aborted).toBe(false);
  });

  it("read a file the cloud refused by the code its call would answer", async () => {
    cloudAnswering(() => new Response(null, { status: 507 }));
    await expect(
      sendFile(cloudOf(SESSION, "0.6.0"), new Uint8Array([1]), "image/png"),
    ).resolves.toStrictEqual({ code: "QUOTA", kind: "refused" });
  });

  it("sign every call to the library the same way", async () => {
    const asked = cloudAnswering(() => Response.json({ json: null }, { status: 500 }));
    await cloudOf(SESSION, "0.6.0")
      .saveLink({ id: "x", opId: "y", url: "https://example.test" })
      .catch(() => null);
    const [call] = asked;
    expect(new URL(call?.url ?? "").pathname).toBe("/v1/rpc/library/items/saveLink");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${SESSION.bearer}`);
    expect(call?.headers.get("x-inteligir-build")).toBe("0.6.0+extension");
  });
});
