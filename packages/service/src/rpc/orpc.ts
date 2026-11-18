import { v1Contract } from "@repo/contract/rpc/v1-contract";
import { implement } from "@orpc/server";
import type { ResponseHeadersHandlerPluginContext } from "@orpc/server/plugins";

import type { JobKick } from "../library/library-store";
import type { AppPrincipal } from "./admit";

// `resHeaders`: the answer's headers, which a refusal's wait reaches as `retry-after` (`./v1-rpc`)
export interface RpcContext extends ResponseHeadersHandlerPluginContext {
  // admitted before the handler matched a row (`./admit`), so every row runs for a session
  readonly principal: AppPrincipal;
  // the credential a row hands Better Auth back, as deletion's password check does
  readonly headers: Headers;
  readonly kickJobs: JobKick;
}

export const os = implement(v1Contract).$context<RpcContext>();
