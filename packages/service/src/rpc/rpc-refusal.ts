// An answer outside any procedure (the build floor, a credential, a fault), spelled as the RPC
// protocol answers an error (https://orpc.dev/docs/advanced/rpc-protocol): the status
// `V1_ERROR_STATUS_MAP` gives its code and its serialized error, so a client's link reads it as it
// reads a procedure's own (`@repo/contract/rpc/call-outcome`).

import type { ClientOutdatedError, UnauthorizedError } from "@repo/contract/rpc/v1-errors";
import { TooManyRequestsError, V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { ORPCError, RPCSerializer } from "@orpc/server";

// what a request may meet before its procedure runs, which every row declares (`signedBase`): the
// build floor, the credential, or the session's budget spent until the seconds its next window
// opens in, answered as `TooManyRequestsError` with that `retry-after`, which a client's link waits
// out (`@repo/contract/rpc/call-outcome`)
export type RpcRefusal =
  | InstanceType<typeof ClientOutdatedError | typeof UnauthorizedError>
  | { readonly retryAfterSeconds: number };

const serializer = new RPCSerializer();

const declared = (
  refusal: InstanceType<
    typeof ClientOutdatedError | typeof TooManyRequestsError | typeof UnauthorizedError
  >,
  headers: HeadersInit = {},
): Response =>
  Response.json(serializer.serialize({ ...refusal.toJSON(), defined: true }), {
    headers,
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });

// marked declared, so a client narrows it as it narrows a refusal its row threw
export const rpcRefusal = (refusal: RpcRefusal): Response =>
  "retryAfterSeconds" in refusal
    ? declared(new TooManyRequestsError(), { "retry-after": String(refusal.retryAfterSeconds) })
    : declared(refusal);

// the internal error no row declares, which a client reads as the cloud out of reach
export const rpcFault = (): Response =>
  Response.json(serializer.serialize(new ORPCError("INTERNAL_SERVER_ERROR").toJSON()), {
    status: V1_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR,
  });
