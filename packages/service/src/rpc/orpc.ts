import { v1Contract } from "@repo/contract/rpc/v1-contract";
import { implement } from "@orpc/server";

import type { JobKick } from "../library/library-store";
import type { AppPrincipal } from "./admit";

export interface RpcContext {
  readonly principal: AppPrincipal;
  readonly headers: Headers;
  readonly kickJobs: JobKick;
}

export const os = implement(v1Contract).$context<RpcContext>();
