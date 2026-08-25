// THE HTTP STATUS EVERY LOCAL REFUSAL ANSWERS, in ONE place.
//
// oRPC v2 keeps no `status` on an error or its contract definition — the handler
// maps code → status through its `errorStatusMap`, and `defined` (does the code
// match a `.errors` row) is decoupled from it. So status lives here: the built-in
// codes from oRPC's own `COMMON_ERROR_STATUS_MAP`, this domain's custom codes from
// the contract's `LOCAL_ERROR_STATUS_MAP`. The RPCHandler reads `ERROR_STATUS_MAP`,
// and `/vault/asset` (a raw-HTTP surface outside the contract) reads `errorStatus`
// — so one refusal answers the same status on the procedure surface and the byte
// surface.

import { COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import { LOCAL_ERROR_STATUS_MAP } from "@repo/api/local/errors";

const STATUS_BY_CODE = new Map<string, number>([
  ...Object.entries(COMMON_ERROR_STATUS_MAP),
  ...Object.entries(LOCAL_ERROR_STATUS_MAP),
]);

/** The plain-object form the RPCHandler's `errorStatusMap` takes. */
export const ERROR_STATUS_MAP = Object.fromEntries(STATUS_BY_CODE);

/** The status a code answers, or 500 for anything unmapped — a genuine fault. */
export function errorStatus(code: string): number {
  return STATUS_BY_CODE.get(code) ?? 500;
}
