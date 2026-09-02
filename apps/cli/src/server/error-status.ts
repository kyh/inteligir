// orpc v2 keeps no status on an error or its contract row: the handler maps code → status
// through `errorStatusMap`, and /vault/asset (raw http, outside the contract) reads
// `errorStatus`, so one refusal answers the same status on both surfaces.

import { COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import { LOCAL_ERROR_STATUS_MAP } from "@repo/api/local/errors";

const STATUS_BY_CODE = new Map<string, number>([
  ...Object.entries(COMMON_ERROR_STATUS_MAP),
  ...Object.entries(LOCAL_ERROR_STATUS_MAP),
]);

export const ERROR_STATUS_MAP = Object.fromEntries(STATUS_BY_CODE);

export function errorStatus(code: string): number {
  return STATUS_BY_CODE.get(code) ?? 500;
}
