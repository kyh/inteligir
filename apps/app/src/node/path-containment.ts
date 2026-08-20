// "Is this path under that root?", answered ONCE. Every caller in this process
// asks the same question about a real machine's paths — the vault root against
// a resolved write target, the data dir against the vault, a provider-reported
// path against the repo — and each hand-rolled answer had its own edge cases:
// whether the root itself counts, whether `..draft.md` is an escape, whether a
// separator-less `..` is. A path that one gate admits and another refuses is
// how a traversal reaches the second gate believing it passed the first.
//
// Neither helper resolves or realpaths its arguments: containment is only
// meaningful between paths the CALLER has already made comparable, and a
// helper that silently resolved would hide a missing realpath from the one
// caller (`vault-service`) whose whole guard is physical.

import { isAbsolute, relative, sep } from "node:path";

/** True when `child` IS `parent` or sits beneath it. Prefix-compared with the
 *  separator attached, so `/vault-backup` is not inside `/vault`. */
export function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * `absPath` as a `/`-joined path relative to `root`, or null when it is not
 * strictly beneath it. The root itself answers null: every caller wants an
 * entry, and `""` is not one.
 *
 * The refusal is these four shapes rather than a bare `startsWith("..")`,
 * which would also eat a legal root entry named `..draft.md`.
 */
export function relativeUnder(root: string, absPath: string): string | null {
  const rel = relative(root, absPath);
  if (rel.length === 0 || rel === "." || isAbsolute(rel)) {
    return null;
  }
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../")) {
    return null;
  }
  return rel.split(sep).join("/");
}

/**
 * The vault is a git repo the sync loop pushes; a data dir inside it would be
 * staged and shipped (SQLite, config, secrets), and a vault inside the data
 * dir would be swept by data-dir tooling. Neither nesting has a sane meaning,
 * so the configuration is refused instead of half-guarded at runtime. Both
 * arguments must already be resolved.
 */
export function assertVaultAndDataDirDisjoint(vaultDir: string, dataDir: string): void {
  if (pathContains(vaultDir, dataDir) || pathContains(dataDir, vaultDir)) {
    throw new Error(
      `The vault directory and the data directory must be disjoint, but vault "${vaultDir}" and data dir "${dataDir}" nest. ` +
        `Set INTELIGIR_VAULT_DIR (or config.json's vaultDir) to a folder outside the data dir.`,
    );
  }
}

/**
 * The model cache must not sit inside the vault. Same reason the data dir may
 * not: the vault is a git repo the sync loop pushes, and a model directory
 * under it would stage and ship a multi-megabyte binary weights file. Only the
 * vault is checked, not the data dir — the model dir DEFAULTS to
 * `<dataDir>/models`, which is intended: it is a cache the data dir owns, and
 * deleting the data dir takes it with no harm. Both arguments must already be
 * resolved.
 */
export function assertModelDirOutsideVault(modelDir: string, vaultDir: string): void {
  if (pathContains(vaultDir, modelDir) || pathContains(modelDir, vaultDir)) {
    throw new Error(
      `The model directory must be outside the vault, but model dir "${modelDir}" and vault "${vaultDir}" nest. ` +
        `A model under the vault would be committed and pushed. Set INTELIGIR_MODEL_DIR to a folder outside the vault.`,
    );
  }
}

/**
 * Agent memory must not sit inside the vault. Same reason the model dir and the
 * data dir may not: the vault is a git repo the sync loop pushes, and memory —
 * the agent's model of the USER — under it would be committed and pushed with
 * the notes. It is machine-global (about the user, not a vault) and shared
 * across checkouts, so only the vault is checked. Both arguments must already
 * be resolved.
 */
export function assertMemoryDirOutsideVault(memoryDir: string, vaultDir: string): void {
  if (pathContains(vaultDir, memoryDir) || pathContains(memoryDir, vaultDir)) {
    throw new Error(
      `The memory directory must be outside the vault, but memory dir "${memoryDir}" and vault "${vaultDir}" nest. ` +
        `Memory under the vault would be committed and pushed. Set INTELIGIR_MEMORY_DIR to a folder outside the vault.`,
    );
  }
}
