import { v1Contract } from "@repo/contract/rpc/v1-contract";
import { implement } from "@orpc/server";

import type { AppPrincipal } from "./admit";

export interface RpcContext {
  // admitted before the handler matched a row (`./admit`), so every row runs for a session
  readonly principal: AppPrincipal;
  // the credential a row hands Better Auth back, as deletion's password check does
  readonly headers: Headers;
}

export const os = implement(v1Contract).$context<RpcContext>();
