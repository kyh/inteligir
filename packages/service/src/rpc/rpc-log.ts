import { isOrpcError, V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";

import { errorFields } from "../log";

const statusOf = (code: string) =>
  Object.entries(V1_ERROR_STATUS_MAP).find(([mapped]) => mapped === code)?.[1];

export const logRpcFailure = (event: string, path: readonly string[], cause: unknown) => {
  if (isOrpcError(cause) && cause.defined) {
    return;
  }

  const fields = { event, path: path.join("."), ...errorFields(cause) };
  const status = isOrpcError(cause) ? statusOf(cause.code) : undefined;

  if (isOrpcError(cause) && status !== undefined && status < 500) {
    console.warn({ ...fields, code: cause.code, status });

    return;
  }

  console.error(fields);
};
