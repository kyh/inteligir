// `/v1`'s one wire, `/v1/rpc` (`@repo/contract/cloud/v1`): the build floor first, before anything
// reads the request; then `account.*` on the Worker's own handler (`./account-router`), and
// `library.*` forwarded whole to the account's library cell, which serves it
// (`../library/library-rpc`). A forwarded call carries the principal its credential verified, and
// only that: any identity header the request brought is dropped, and so are its credentials,
// which the cell never reads.

import { forwardAsPrincipal } from "../library/library-principal";
import type { AppPrincipal } from "../library/library-principal";
import { V1_LIBRARY_RPC_PATH } from "../library/library-rpc";
import { isBelowFloor } from "../client-floor";
import { createDb } from "../db/client";
import { spendDeviceBudget } from "../rate-limit";
import { serveAccountRpc } from "./account-router";
import { rpcRefusal } from "./rpc-refusal";
import { holderIdOf, lazyPrincipal } from "./v1-principal";

const forwardLibraryCall = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  principal: () => Promise<AppPrincipal | null>,
): Promise<Response> => {
  const verified = await principal();
  if (verified === null) {
    return await rpcRefusal("UNAUTHORIZED");
  }
  if (!(await spendDeviceBudget(env, createDb(env.DB), "rpc", holderIdOf(verified)))) {
    return await rpcRefusal("TOO_MANY_REQUESTS");
  }
  return await forwardAsPrincipal(ctx.exports, request, verified);
};

export const handleV1Rpc = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  if (isBelowFloor(request, env)) {
    return await rpcRefusal("CLIENT_OUTDATED");
  }
  const principal = lazyPrincipal(request, env, ctx);
  if (url.pathname.startsWith(`${V1_LIBRARY_RPC_PATH}/`)) {
    return await forwardLibraryCall(request, env, ctx, principal);
  }
  const answered = await serveAccountRpc(request, { ctx, env, principal, request });
  return answered ?? new Response("not found", { status: 404 });
};
