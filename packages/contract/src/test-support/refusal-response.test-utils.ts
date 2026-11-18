import { RPCSerializer } from "@orpc/client";
import type { ORPCError } from "@orpc/client";

import { V1_ERROR_STATUS_MAP } from "../rpc/v1-errors";

export const refusalResponse = (refusal: ORPCError<keyof typeof V1_ERROR_STATUS_MAP, unknown>) =>
  Response.json(new RPCSerializer().serialize({ ...refusal.toJSON(), defined: true }), {
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });
