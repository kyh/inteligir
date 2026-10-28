// What a `/v1/rpc` handler logs of a call that failed, from oRPC's `onError` interceptor
// (https://orpc.dev/docs/rpc/handler): a refusal the call's row declares is an answer and logs
// nothing; a call the client sent malformed (its input, a cursor, any code no row declares that
// the wire answers 4xx) is a warning; and only a throw that is no client's error, or a server
// fault, is an error, so Workers Logs reads nothing but those as an outage.

import { V1_ERROR_STATUS_MAP } from "@repo/contract/cloud/v1/errors";
import { ORPCError } from "@orpc/server";

import { errorFields } from "../log";

// the status the wire answers a code with, as every `/v1` handler maps it
const statusOf = (code: string): number | undefined =>
  Object.entries(V1_ERROR_STATUS_MAP).find(([mapped]) => mapped === code)?.[1];

export const logRpcFailure = (event: string, path: readonly string[], cause: unknown): void => {
  if (cause instanceof ORPCError && cause.defined) {
    return;
  }
  const fields = { event, path: path.join("."), ...errorFields(cause) };
  const status = cause instanceof ORPCError ? statusOf(cause.code) : undefined;
  if (cause instanceof ORPCError && status !== undefined && status < 500) {
    console.warn({ ...fields, code: cause.code, status });
    return;
  }
  console.error(fields);
};
