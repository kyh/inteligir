import type {
  ClientOutdatedError,
  TooManyRequestsError,
  UnauthorizedError,
} from "@repo/contract/rpc/v1-errors";
import { isOrpcError, retryAfterSchema, V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { ORPCError, RPCSerializer } from "@orpc/server";

export type RpcRefusal = InstanceType<
  typeof ClientOutdatedError | typeof TooManyRequestsError | typeof UnauthorizedError
>;

export const retryAfterOf = (cause: unknown) =>
  isOrpcError(cause) && cause.code === "TOO_MANY_REQUESTS"
    ? (retryAfterSchema.safeParse(cause.data).data?.retryAfterSeconds ?? null)
    : null;

const serializer = new RPCSerializer();

export const rpcRefusal = (refusal: RpcRefusal) => {
  const retryAfter = retryAfterOf(refusal);

  return Response.json(serializer.serialize({ ...refusal.toJSON(), defined: true }), {
    headers: retryAfter === null ? {} : { "retry-after": String(retryAfter) },
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });
};

export const rpcFault = () =>
  Response.json(serializer.serialize(new ORPCError("INTERNAL_SERVER_ERROR").toJSON()), {
    status: V1_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR,
  });
