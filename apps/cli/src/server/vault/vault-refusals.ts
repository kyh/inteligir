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
// reads it.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { ORPCError } from "@orpc/server";
import { VaultServiceError, type VaultServiceErrorCode } from "./vault-service";

const VAULT_REFUSALS = {
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  too_large: "PAYLOAD_TOO_LARGE",
  invalid_path: "INVALID_PATH",
} as const satisfies Record<VaultServiceErrorCode | "invalid_path", string>;

/** The HTTP status each wire class carries, for the one surface that answers
 *  in statuses rather than in classes. */
const REFUSAL_STATUS = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_PATH: 400,
} as const satisfies Record<(typeof VAULT_REFUSALS)[keyof typeof VAULT_REFUSALS], number>;

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

/** The status this class carries. Inferred rather than widened to `number`,
 *  so a caller answering an HTTP status gets the literal union it needs. */
export function vaultRefusalStatus(cause: unknown) {
  const wireClass = vaultWireClass(cause);
  return wireClass === null ? null : REFUSAL_STATUS[wireClass];
}
