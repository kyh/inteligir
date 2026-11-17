// A refusal the Worker answers outside any procedure (the build floor, a credential, a rate
// window, a file it will not keep), spelled as the RPC protocol answers an error
// (https://orpc.dev/docs/advanced/rpc-protocol): the status `V1_ERROR_STATUS_MAP` gives its code,
// and its serialized error, marked as declared, so a client narrows it as it narrows a procedure's
// own, an RPCLink's call and an upload alike (`@repo/contract/library/call-outcome`).

import {
  AccountGoneError,
  BlobMismatchError,
  ClientOutdatedError,
  PayloadTooLargeError,
  QuotaError,
  TooManyRequestsError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "@repo/contract/v1/errors";
import { ORPCError, reconcileORPCError, RPCSerializer } from "@orpc/server";

import { plainText } from "../plain-http";

// what any request may meet, and what a file's upload may, which is no row to declare them on
const REFUSALS = {
  [AccountGoneError.code]: AccountGoneError,
  [BlobMismatchError.code]: BlobMismatchError,
  [ClientOutdatedError.code]: ClientOutdatedError,
  [PayloadTooLargeError.code]: PayloadTooLargeError,
  [QuotaError.code]: QuotaError,
  [TooManyRequestsError.code]: TooManyRequestsError,
  [UnauthorizedError.code]: UnauthorizedError,
};

type Refusal = InstanceType<(typeof REFUSALS)[keyof typeof REFUSALS]>;

const serializer = new RPCSerializer();

export const rpcRefusal = async (refusal: Refusal): Promise<Response> => {
  const declared = await reconcileORPCError(REFUSALS, refusal);
  return Response.json(serializer.serialize(declared.toJSON()), {
    status: V1_ERROR_STATUS_MAP[refusal.code],
  });
};

// the same refusal where no client reads a body, a socket's upgrade: its status and its sentence
export const plainRefusal = (refusal: Refusal): Response =>
  plainText(V1_ERROR_STATUS_MAP[refusal.code], refusal.message);

// a fault outside every procedure (a store that did not answer), as the protocol answers one: the
// internal error no row declares, which a client retries
export const rpcFault = (): Response =>
  Response.json(serializer.serialize(new ORPCError("INTERNAL_SERVER_ERROR").toJSON()), {
    status: V1_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR,
  });
