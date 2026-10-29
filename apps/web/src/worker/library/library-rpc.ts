// The library's procedures served in the account's cell, on the one `/v1` wire under
// `/v1/rpc/library` (`@repo/contract/cloud/v1`): oRPC's RPC handler over the cell's router, with
// its default methods (no GET, so nothing a call carries rides a URL), a body cap, every code the
// wire declares mapped to its status, and any failure no row declares logged by its severity
// (`../wire/rpc-log`).
// The Worker forwards each call here whole, its principal stamped (`../wire/v1-rpc`).

import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { V1_ERROR_STATUS_MAP } from "@repo/contract/cloud/v1/errors";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";

import { logRpcFailure } from "../wire/rpc-log";
import { libraryRouter } from "./library-router";
import type { CellContext } from "./library-router";

export const V1_LIBRARY_RPC_PATH = `${V1_RPC_PATH}/library` as const;

// the largest call a client sends: one item's write at its text cap (8 MiB), with the JSON it
// rides in
export const LIBRARY_RPC_MAX_BODY_BYTES = 16 * 1024 * 1024;

const handler = new RPCHandler(libraryRouter, {
  errorStatusMap: V1_ERROR_STATUS_MAP,
  interceptors: [
    onError((cause, { path }) => {
      logRpcFailure("library-rpc-failed", path, cause);
    }),
  ],
  plugins: [new RequestLimitHandlerPlugin({ maxBodySize: LIBRARY_RPC_MAX_BODY_BYTES })],
});

// the call's answer, or null for a path the library does not serve
export const serveLibraryRpc = async (
  request: Request,
  context: CellContext,
): Promise<Response | null> => {
  const { matched, response } = await handler.handle(request, {
    context,
    prefix: V1_LIBRARY_RPC_PATH,
  });
  return matched ? response : null;
};
