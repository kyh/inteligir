// orpc v2 keeps no status on an error or its contract row: the handler maps code → status
// through `errorStatusMap`, and the rpc interceptor reads `errorStatus` to tell a refusal from a
// fault, so one code answers one status everywhere.

import { COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import { LOCAL_ERROR_STATUS_MAP } from "@repo/contract/local/errors";

const STATUS_BY_CODE = new Map<string, number>([
  ...Object.entries(COMMON_ERROR_STATUS_MAP),
  ...Object.entries(LOCAL_ERROR_STATUS_MAP),
]);

export const ERROR_STATUS_MAP = Object.fromEntries(STATUS_BY_CODE);

export const errorStatus = (code: string): number => STATUS_BY_CODE.get(code) ?? 500;
