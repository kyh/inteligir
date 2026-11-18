import type { ClientOutdatedError, UnauthorizedError } from "@repo/contract/rpc/v1-errors";
import { TooManyRequestsError, V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { ORPCError, RPCSerializer } from "@orpc/server";

export type RpcRefusal =
  | InstanceType<typeof ClientOutdatedError | typeof UnauthorizedError>
  | { readonly retryAfterSeconds: number };

const serializer = new RPCSerializer();

const declared = (
  refusal: InstanceType<
    typeof ClientOutdatedError | typeof TooManyRequestsError | typeof UnauthorizedError
  >,
  headers: HeadersInit = {},
) =>
  Response.json(serializer.serialize({ ...refusal.toJSON(), defined: true }), {
    headers,
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });

export const rpcRefusal = (refusal: RpcRefusal) =>
  "retryAfterSeconds" in refusal
    ? declared(new TooManyRequestsError(), { "retry-after": String(refusal.retryAfterSeconds) })
    : declared(refusal);

export const rpcFault = () =>
  Response.json(serializer.serialize(new ORPCError("INTERNAL_SERVER_ERROR").toJSON()), {
    status: V1_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR,
  });
