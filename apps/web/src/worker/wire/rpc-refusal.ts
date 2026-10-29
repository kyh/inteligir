// A refusal the Worker answers before any procedure runs (the build floor, a credential, a rate
// window), spelled as the RPC protocol answers an error (https://orpc.dev/docs/advanced/rpc-protocol):
// the status `V1_ERROR_STATUS_MAP` gives its code, and its serialized error, marked as the error
// every row declares, so an RPCLink client narrows it as it narrows a procedure's own.

import {
  AccountGoneError,
  ClientOutdatedError,
  TooManyRequestsError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "@repo/contract/cloud/v1/errors";
import { ORPCError, reconcileORPCError, RPCSerializer } from "@orpc/server";

// the refusals every signed row declares
const TRANSPORT_ERRORS = {
  [AccountGoneError.code]: AccountGoneError,
  [ClientOutdatedError.code]: ClientOutdatedError,
  [TooManyRequestsError.code]: TooManyRequestsError,
  [UnauthorizedError.code]: UnauthorizedError,
};

export type TransportRefusal = keyof typeof TRANSPORT_ERRORS;

const serializer = new RPCSerializer();

export const rpcRefusal = async (code: TransportRefusal): Promise<Response> => {
  const refusal = await reconcileORPCError(TRANSPORT_ERRORS, new TRANSPORT_ERRORS[code]());
  return Response.json(serializer.serialize(refusal.toJSON()), {
    status: V1_ERROR_STATUS_MAP[code],
  });
};

// a fault outside every procedure (a store that did not answer), as the protocol answers one: the
// internal error no row declares, which a client retries
export const rpcFault = (): Response =>
  Response.json(serializer.serialize(new ORPCError("INTERNAL_SERVER_ERROR").toJSON()), {
    status: V1_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR,
  });
