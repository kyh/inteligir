// One rule for what a guarded write refuses and the words it refuses in: the vault service judges
// under its lock and the CLI's fixture server over its map, so a command's suite cannot pass
// against a guard the server does not have.

import { contentHashHex } from "@repo/contract/local/vault/vault-schema";
import type { VaultWriteGuard } from "@repo/contract/local/vault/vault-schema";

// the wire's guards less `overwrite`, which is `write`.
export type GuardedWriteGuard = Exclude<VaultWriteGuard, { kind: "overwrite" }>;

export type GuardedWriteRefusal =
  | {
      applied: false;
      reason: "hash_mismatch";
      current: { content: string; hash: string } | null;
    }
  | { applied: false; reason: "exists" };

export type GuardedWriteResult = { applied: true; path: string } | GuardedWriteRefusal;

// `held` is null when nothing is at the path, else the read of what is, which answers null for
// something that is not text; a create never reads it.
export const judgeGuard = async (
  guard: GuardedWriteGuard,
  held: (() => Promise<string | null>) | null,
): Promise<GuardedWriteRefusal | null> => {
  if (guard.kind === "absent") {
    return held === null ? null : { applied: false, reason: "exists" };
  }
  const current = held === null ? null : await held();
  if (current === null) {
    // the base the client hashed no longer exists.
    return { applied: false, current: null, reason: "hash_mismatch" };
  }
  const hash = await contentHashHex(current);
  return hash === guard.hash
    ? null
    : { applied: false, current: { content: current, hash }, reason: "hash_mismatch" };
};

// the two constructors vault.write's handler is given, whichever router implements it.
interface GuardErrors {
  ALREADY_EXISTS: (options: { message: string }) => Error;
  CAS_MISMATCH: (options: {
    data: { current?: { content: string; hash: string } };
    message: string;
  }) => Error;
}

export const guardRefusalError = (
  errors: GuardErrors,
  path: string,
  refusal: GuardedWriteRefusal,
): Error =>
  refusal.reason === "exists"
    ? errors.ALREADY_EXISTS({ message: `A file already exists at ${path}` })
    : errors.CAS_MISMATCH({
        // the client merges current with diff3 and retries; current is absent when the file is gone.
        data: refusal.current === null ? {} : { current: refusal.current },
        message: `${path} changed since the base this write was derived from`,
      });
