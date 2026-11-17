// `/v1`'s one wire, `/v1/rpc` (`@repo/contract/rpc/v1-contract`): every call is admitted first
// (`./admit`), before anything reads its path or body, then served by the rows routed so far, with
// oRPC's default methods (no GET, so nothing a call carries rides a URL).

import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import { V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";

import { logUnhandled } from "../log";
import { accountRouter } from "./account-router";
import { admit } from "./admit";
import { libraryRouter } from "./library-router";
import { logRpcFailure } from "./rpc-log";
import { rpcFault, rpcRefusal } from "./rpc-refusal";

// every contract row this serves; ./unrouted.test.ts names the rest
export const v1Router = { account: accountRouter, library: libraryRouter };

// the largest call routed: an account's, a password or an id
const V1_RPC_MAX_BODY_BYTES = 64 * 1024;

const handler = new RPCHandler(v1Router, {
  errorStatusMap: V1_ERROR_STATUS_MAP,
  interceptors: [
    onError((cause, { path }) => {
      logRpcFailure("v1-rpc-failed", path, cause);
    }),
  ],
  plugins: [new RequestLimitHandlerPlugin({ maxBodySize: V1_RPC_MAX_BODY_BYTES })],
});

export const handleV1Rpc = async (request: Request): Promise<Response> => {
  // Next's own answer to a throw is no answer the client's link reads, so a fault is answered in
  // the wire's protocol and logged with its request
  try {
    const admission = await admit(request);
    if (admission.kind === "refused") {
      return rpcRefusal(admission.refusal);
    }
    const { matched, response } = await handler.handle(request, {
      context: { headers: request.headers, principal: admission.principal },
      prefix: V1_RPC_PATH,
    });
    return matched ? response : new Response("not found", { status: 404 });
  } catch (error) {
    logUnhandled(request, error);
    return rpcFault();
  }
};
