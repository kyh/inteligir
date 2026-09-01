// WHAT DOES THE WIRE CALL A VAULT REFUSAL? Answered once, here.
//
// Three surfaces reach `VaultService` and each has to name its refusals: the
// vault procedures, the comments procedures (the sidecar lives in the vault),
// and `/vault/asset`, which is outside the contract entirely and answers in
// HTTP statuses. Three copies of one table is three answers that can disagree
// — and they did: a sidecar write refused for `conflict` answered 500 while
// `vault.write` answered 409, and an oversize sidecar answered 500 while the
// asset route answered 413.
//
// The table is TOTAL over `VaultServiceErrorCode` (the `satisfies` below is
// what enforces that), so a new code is a compile error here rather than a
// silent 500 in whichever surface forgot it. WHICH classes a given procedure
// can raise is still declared per row, in the contract, where the client
// reads it. The HTTP status a class answers is NOT here any more — oRPC v2
// keeps none on the error, so the asset route reads `errorStatus` from the one
// map the handler also uses (`error-status.ts`). The table is exported for
// exactly one reader: `__tests__/vault-contract-errors.test.ts`, which holds
// every class a row declares to a producer — this table, or an explicit throw.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { ORPCError } from "@orpc/server";
import { errorStatus } from "../error-status";
import { VaultServiceError, type VaultServiceErrorCode } from "./vault-service";

export const VAULT_REFUSALS = {
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  too_large: "PAYLOAD_TOO_LARGE",
  invalid_path: "INVALID_PATH",
} as const satisfies Record<VaultServiceErrorCode | "invalid_path", string>;

type VaultWireClass = (typeof VAULT_REFUSALS)[keyof typeof VAULT_REFUSALS];

/** The wire class a vault refusal is, or null for anything this layer has no
 *  name for — which is a 500, and should be. */
function vaultWireClass(cause: unknown): VaultWireClass | null {
  if (cause instanceof VaultPathError) return VAULT_REFUSALS.invalid_path;
  if (cause instanceof VaultServiceError) return VAULT_REFUSALS[cause.code];
  return null;
}

export function vaultWireError(cause: unknown): ORPCError<string, unknown> | null {
  const wireClass = vaultWireClass(cause);
  if (wireClass === null || !(cause instanceof Error)) return null;
  return new ORPCError(wireClass, { message: cause.message });
}

/** The HTTP status a vault refusal answers, for the one surface that answers in
 *  statuses rather than classes. Null for anything with no wire class. */
export function vaultRefusalStatus(cause: unknown): number | null {
  const wireClass = vaultWireClass(cause);
  return wireClass === null ? null : errorStatus(wireClass);
}
