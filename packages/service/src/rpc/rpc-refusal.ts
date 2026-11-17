// An answer outside any procedure (the build floor, a credential, a fault), spelled as the RPC
// protocol answers an error (https://orpc.dev/docs/advanced/rpc-protocol): the status
// `V1_ERROR_STATUS_MAP` gives its code and its serialized error, so a client's link reads it as it
// reads a procedure's own (`@repo/contract/rpc/call-outcome`).

import type { ClientOutdatedError, UnauthorizedError } from "@repo/contract/rpc/v1-errors";
import { V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { ORPCError, RPCSerializer } from "@orpc/server";

// what a request may meet before its procedure runs, which every row declares (`signedBase`)
export type RpcRefusal = InstanceType<typeof ClientOutdatedError | typeof UnauthorizedError>;

const serializer = new RPCSerializer();

// marked declared, so a client narrows it as it narrows a refusal its row threw
export const rpcRefusal = (refusal: RpcRefusal): Response =>
  Response.json(serializer.serialize({ ...refusal.toJSON(), defined: true }), {
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });

// the internal error no row declares, which a client reads as the cloud out of reach
export const rpcFault = (): Response =>
  Response.json(serializer.serialize(new ORPCError("INTERNAL_SERVER_ERROR").toJSON()), {
    status: V1_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR,
  });
