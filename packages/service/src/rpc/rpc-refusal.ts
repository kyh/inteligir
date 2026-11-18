import type {
  ClientOutdatedError,
  TooManyRequestsError,
  UnauthorizedError,
} from "@repo/contract/rpc/v1-errors";
import { V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { ORPCError, RPCSerializer } from "@orpc/server";

export type RpcRefusal = InstanceType<
  typeof ClientOutdatedError | typeof TooManyRequestsError | typeof UnauthorizedError
>;

const serializer = new RPCSerializer();

export const rpcRefusal = (refusal: RpcRefusal) =>
  Response.json(serializer.serialize({ ...refusal.toJSON(), defined: true }), {
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });

export const rpcFault = () =>
  Response.json(serializer.serialize(new ORPCError("INTERNAL_SERVER_ERROR").toJSON()), {
    status: V1_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR,
  });
