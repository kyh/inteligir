// one table for the vault procedures, the comments procedures and the asset route: three
// copies disagreed (a sidecar conflict answered 500 while vault.write answered 409). total
// over VaultServiceErrorCode via satisfies, so a new code fails to compile rather than 500ing.

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

// null is a 500, and should be.
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

export function vaultRefusalStatus(cause: unknown): number | null {
  const wireClass = vaultWireClass(cause);
  return wireClass === null ? null : errorStatus(wireClass);
}
