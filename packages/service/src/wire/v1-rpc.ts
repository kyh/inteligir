// `/v1`'s one wire, `/v1/rpc` (`@repo/contract/v1`): every call is admitted first
// (`./v1-principal`), before anything reads it; then `account.*` runs on the Worker's own handler
// (`./account-router`), and `library.*` is forwarded whole to the account's library cell, which
// serves it (`../library/library-rpc`). A forwarded call carries the principal its credential
// verified, and only that: any identity header the request brought is dropped, and so are its
// credentials, which the cell never reads.

import { forwardAsPrincipal } from "../library/library-principal";
import { V1_LIBRARY_RPC_PATH } from "../library/library-rpc";
import { serveAccountRpc } from "./account-router";
import { rpcRefusal } from "./rpc-refusal";
import { admit } from "./v1-principal";

export const handleV1Rpc = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  const admission = await admit(request, env, ctx, env.RPC_LIMIT);
  if (admission.kind === "refused") {
    return await rpcRefusal(admission.refusal);
  }
  const { principal } = admission;
  if (url.pathname.startsWith(`${V1_LIBRARY_RPC_PATH}/`)) {
    return await forwardAsPrincipal(ctx.exports, request, principal);
  }
  const answered = await serveAccountRpc(request, env, ctx, principal);
  return answered ?? new Response("not found", { status: 404 });
};
