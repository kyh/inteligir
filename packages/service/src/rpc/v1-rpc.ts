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
import { os } from "./orpc";
import type { RpcContext } from "./orpc";
import { logRpcFailure } from "./rpc-log";
import { rpcFault, rpcRefusal } from "./rpc-refusal";

const v1Router = os.router({ account: accountRouter, library: libraryRouter });

type HandlerPlugins = NonNullable<RPCHandlerOptions<RpcContext>["plugins"]>;

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

const STREAM_MS = 280_000;

const serving = (handler: ReturnType<typeof handlerOf>) => async (request: Request) => {
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

export const handleV1Stream = serving(
  handlerOf([
    new TimeoutHandlerPlugin({ streamingTimeout: STREAM_MS, timeout: null }),
    new SignalSyncHandlerPlugin(),
  ]),
);
