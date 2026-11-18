// `/v1`'s one wire, `/v1/rpc` (`@repo/contract/rpc/v1-contract`): every call is admitted first
// (`./admit`), before anything reads its path or body, then served by the rows routed so far, with
// oRPC's default methods (no GET, so nothing a call carries rides a URL).

import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import { V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { RPCHandlerOptions } from "@orpc/server/fetch";
import {
  RequestLimitHandlerPlugin,
  SignalSyncHandlerPlugin,
  TimeoutHandlerPlugin,
} from "@orpc/server/plugins";

import { FUNCTION_MAX_BODY_BYTES } from "../function-limits";
import { kickJobs } from "../jobs/drain-jobs";
import { logUnhandled } from "../log";
import { accountRouter } from "./account-router";
import { admit } from "./admit";
import { libraryRouter } from "./library-router";
import type { RpcContext } from "./orpc";
import { logRpcFailure } from "./rpc-log";
import { rpcFault, rpcRefusal } from "./rpc-refusal";

// every contract row this serves; ./unrouted.test.ts names the rest
export const v1Router = { account: accountRouter, library: libraryRouter };

type HandlerPlugins = NonNullable<RPCHandlerOptions<RpcContext>["plugins"]>;

// every handler's plugins first hold the largest call routed, a body of BODY_MAX_BYTES and the
// call around it
const handlerOf = (plugins: HandlerPlugins) =>
  new RPCHandler(v1Router, {
    errorStatusMap: V1_ERROR_STATUS_MAP,
    interceptors: [
      onError((cause, { path }) => {
        logRpcFailure("v1-rpc-failed", path, cause);
      }),
    ],
    plugins: [new RequestLimitHandlerPlugin({ maxBodySize: FUNCTION_MAX_BODY_BYTES }), ...plugins],
  });

// a stream ends this long after it starts, inside its route's 300 s `maxDuration`, as a dropped
// connection does, so its device reconnects where it left off; it also stops once the device left
const STREAM_MS = 280_000;

const serving =
  (handler: ReturnType<typeof handlerOf>) =>
  async (request: Request): Promise<Response> => {
    // Next's own answer to a throw is no answer the client's link reads, so a fault is answered in
    // the wire's protocol and logged with its request
    try {
      const admission = await admit(request, "rpcCall");
      if (admission.kind === "refused") {
        return rpcRefusal(admission.refusal);
      }
      const { matched, response } = await handler.handle(request, {
        context: { headers: request.headers, kickJobs, principal: admission.principal },
        prefix: V1_RPC_PATH,
      });
      return matched ? response : new Response("not found", { status: 404 });
    } catch (error) {
      logUnhandled(request, error);
      return rpcFault();
    }
  };

export const handleV1Rpc = serving(handlerOf([]));

// a row that streams (`library.agent.events`), served at its own path below `/v1/rpc`, whose route
// allows a longer `maxDuration` than the rest
export const handleV1Stream = serving(
  handlerOf([
    new TimeoutHandlerPlugin({ streamingTimeout: STREAM_MS, timeout: null }),
    new SignalSyncHandlerPlugin(),
  ]),
);
