// The cell's own RPC handler, reached as an app's link reaches it: the statuses the wire maps its
// refusals to, the body cap, and no procedure answered on a GET.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cellIn, cellOf, clockAt, inCell } from "../test-support/library-cell";
import { LIBRARY_RPC_MAX_BODY_BYTES, serveLibraryRpc, V1_LIBRARY_RPC_PATH } from "./library-rpc";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";

const ORIGIN = "https://cell.test";

// the library's rows over the cell's handler, with a cap on what the library may hold
const linkIn = (state: DurableObjectState, bytesCap: number) => {
  const { context } = cellIn(state, { bytesCap, clock: clockAt() });
  const serve = async (request: Request): Promise<Response> =>
    (await serveLibraryRpc(request, context)) ?? new Response("not found", { status: 404 });
  // a client reads a refusal's code and data from its body, and the status only the response holds
  const statuses: number[] = [];
  const client = createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => {
        const response = await serve(new Request(url, init));
        statuses.push(response.status);
        return response;
      },
      origin: ORIGIN,
      url: V1_RPC_PATH,
    }),
  );
  // the refusal a call met, with the status it was answered under
  const refusalOf = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (error) {
      if (isOrpcError(error)) {
        return { code: error.code, data: error.data, status: statuses.at(-1) };
      }
      throw error;
    }
    throw new Error("the call landed what the test expected it to refuse");
  };
  return { library: client.library, refusalOf, serve };
};

// three hundred tags no other call names, which two calls together hold past an item's cap
const tags = (from: number): string[] =>
  Array.from({ length: 300 }, (_, index) => `tag-${String(from + index)}`);

describe("the cell's RPC handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a malformed call as a warning and a declared refusal not at all, so neither reads as an outage", async () => {
    await inCell(cellOf(), async (state) => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { library, refusalOf } = linkIn(state, 64 * 1024);
      await expect(refusalOf(library.search({ query: " " }))).resolves.toMatchObject({
        code: "BAD_REQUEST",
        status: 400,
      });
      expect(warnings).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "BAD_REQUEST",
          event: "library-rpc-failed",
          path: "search",
        }),
      );
      await expect(
        refusalOf(library.items.createNote({ markdown: "x".repeat(200_000) })),
      ).resolves.toMatchObject({ code: "QUOTA" });
      expect(warnings).toHaveBeenCalledOnce();
      expect(errors).not.toHaveBeenCalled();
    });
  });

  it("answers a write past the library's cap as full, with what it holds", async () => {
    await inCell(cellOf(), async (state) => {
      const { library, refusalOf } = linkIn(state, 64 * 1024);
      await expect(
        refusalOf(library.items.createNote({ markdown: "x".repeat(200_000) })),
      ).resolves.toStrictEqual({
        code: "QUOTA",
        data: { bytesCap: 64 * 1024, bytesUsed: expect.any(Number) },
        status: 507,
      });
    });
  });

  it("answers an item's fields past their cap as too large", async () => {
    await inCell(cellOf(), async (state) => {
      const { library, refusalOf } = linkIn(state, 1024 * 1024 * 1024);
      const { item } = await library.items.createNote({ markdown: "Tagged." });
      await library.items.organize({ addTags: tags(0), ids: [item.id] });
      await expect(
        refusalOf(library.items.organize({ addTags: tags(300), ids: [item.id] })),
      ).resolves.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
    });
  });

  it("refuses a body past its cap before it reads it", async () => {
    await inCell(cellOf(), async (state) => {
      const { library, refusalOf } = linkIn(state, 1024 * 1024 * 1024);
      await expect(
        refusalOf(
          library.items.createNote({ markdown: "x".repeat(LIBRARY_RPC_MAX_BODY_BYTES + 1) }),
        ),
      ).resolves.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
    });
  });

  it("serves no procedure on a GET, so nothing a call carries rides its url", async () => {
    await inCell(cellOf(), async (state) => {
      const { serve } = linkIn(state, 1024 * 1024 * 1024);
      const query = encodeURIComponent(JSON.stringify({ json: {} }));
      const answer = await serve(
        new Request(`${ORIGIN}${V1_LIBRARY_RPC_PATH}/items/list?data=${query}`),
      );
      await answer.arrayBuffer();
      expect(answer.status).toBe(404);
    });
  });
});
