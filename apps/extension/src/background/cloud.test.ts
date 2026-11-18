import { RPCSerializer } from "@orpc/client";
import { fileSha } from "@repo/contract/library/file-sha";
import { refusalResponse } from "@repo/contract/test-support/refusal-response.test-utils";
import { QuotaError } from "@repo/contract/rpc/v1-errors";
import { http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { cloudOf, sendFile } from "./cloud";
import { SESSION } from "./test-support/fake-cloud.test-utils";

afterEach(() => {
  vi.useRealTimers();
});

const network = setupServer();

beforeAll(() => {
  network.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  network.resetHandlers();
});

afterAll(() => {
  network.close();
});

const STORE_URL = "https://vercel.com/api/blob/?pathname=files%2Fa&signature=s";

const serializer = new RPCSerializer();

const RESERVED = Response.json(
  serializer.serialize({
    headers: { "content-type": "image/png" },
    kind: "upload",
    uploadId: "upload-1",
    url: STORE_URL,
  }),
);

interface Script {
  readonly settle?: () => Response;
  readonly storing?: () => Promise<void>;
}

const cloudAnswering = (script: Script = {}) => {
  const asked: Request[] = [];
  network.use(
    http.all("*", async ({ request }) => {
      asked.push(request.clone());

      if (request.url === STORE_URL) {
        await script.storing?.();

        return new Response(null, { status: 200 });
      }

      if (request.url.endsWith("/library/files/reserve")) {
        return RESERVED.clone();
      }

      return script.settle?.() ?? Response.json(serializer.serialize({ kind: "kept" }));
    }),
  );

  return asked;
};

const keepAwake = vi.fn<() => void>();

describe("the extension's calls to its cloud", () => {
  it("send a file's bytes to the store the cloud names, with none of the session's credentials", async () => {
    const asked = cloudAnswering();
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      sendFile(cloudOf(SESSION, "0.6.0", keepAwake), bytes, "image/png"),
    ).resolves.toStrictEqual({ answer: fileSha(bytes), kind: "landed" });
    const [reserve, put, settle] = asked;
    expect(new URL(reserve?.url ?? "").pathname).toBe("/v1/rpc/library/files/reserve");
    expect(reserve?.headers.get("authorization")).toBe(`Bearer ${SESSION.bearer}`);
    expect(reserve?.headers.get("x-inteligir-build")).toBe("0.6.0+extension");
    expect(reserve?.signal.aborted).toBe(false);
    expect(put?.method).toBe("PUT");
    expect(put?.url).toBe(STORE_URL);
    expect(put?.credentials).toBe("omit");
    expect(put?.headers.get("authorization")).toBeNull();
    expect(put?.headers.get("content-type")).toBe("image/png");
    expect(new URL(settle?.url ?? "").pathname).toBe("/v1/rpc/library/files/settle");
  });

  it("keep the worker awake while a file's bytes go, and no longer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    keepAwake.mockClear();
    cloudAnswering({
      storing: async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      },
    });
    await sendFile(cloudOf(SESSION, "0.6.0", keepAwake), new Uint8Array([1]), "image/png");
    expect(keepAwake).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(keepAwake).toHaveBeenCalledTimes(2);
  });

  it("read a file the cloud refused as a call's refusal, by its code and in the cloud's words", async () => {
    cloudAnswering({
      settle: () => refusalResponse(new QuotaError({ data: { bytesCap: 1, bytesUsed: 1 } })),
    });
    await expect(
      sendFile(cloudOf(SESSION, "0.6.0", keepAwake), new Uint8Array([1]), "image/png"),
    ).resolves.toStrictEqual({ code: "QUOTA", kind: "refused", message: "Your library is full." });
  });

  it("sign every call to the library the same way", async () => {
    const asked = cloudAnswering({
      settle: () => Response.json({ json: null }, { status: 500 }),
    });

    await cloudOf(SESSION, "0.6.0", keepAwake)
      .saveLink({ id: "x", opId: "y", url: "https://example.test" })
      .catch(() => null);
    const [call] = asked;
    expect(new URL(call?.url ?? "").pathname).toBe("/v1/rpc/library/items/saveLink");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${SESSION.bearer}`);
    expect(call?.headers.get("x-inteligir-build")).toBe("0.6.0+extension");
  });
});
