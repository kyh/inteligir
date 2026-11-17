// A refusal as the Worker answers one outside a procedure, a call it never admitted or a file it
// would not keep (`packages/service/src/wire/rpc-refusal.ts`): the declared error as the RPC
// protocol serializes it, under its status. For a suite that scripts its cloud.

import { RPCSerializer } from "@orpc/client";
import type { ORPCError } from "@orpc/client";

import { V1_ERROR_STATUS_MAP } from "../rpc/v1-errors";

export const refusalResponse = (
  refusal: ORPCError<keyof typeof V1_ERROR_STATUS_MAP, unknown>,
): Response =>
  Response.json(new RPCSerializer().serialize({ ...refusal.toJSON(), defined: true }), {
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });
