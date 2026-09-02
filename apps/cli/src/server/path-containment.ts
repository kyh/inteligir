// neither helper resolves or realpaths its arguments: a helper that silently
// resolved would hide a missing realpath from the caller whose guard is physical.

import { isAbsolute, relative, sep } from "node:path";

// separator attached, so /vault-backup is not inside /vault.
export function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

// the root itself answers null: every caller wants an entry, and "" is not one.
// not a bare startsWith(".."): that also eats a legal entry named `..draft.md`.
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

// both arguments must already be resolved.
export function assertVaultAndDataDirDisjoint(vaultDir: string, dataDir: string): void {
  if (pathContains(vaultDir, dataDir) || pathContains(dataDir, vaultDir)) {
    throw new Error(
      `The vault directory and the data directory must be disjoint, but vault "${vaultDir}" and data dir "${dataDir}" nest. ` +
        `Set INTELIGIR_VAULT_DIR (or config.json's vaultDir) to a folder outside the data dir.`,
    );
  }
}

// only the vault is checked: the model dir defaults to <dataDir>/models on purpose.
// both arguments must already be resolved.
export function assertModelDirOutsideVault(modelDir: string, vaultDir: string): void {
  if (pathContains(vaultDir, modelDir) || pathContains(modelDir, vaultDir)) {
    throw new Error(
      `The model directory must be outside the vault, but model dir "${modelDir}" and vault "${vaultDir}" nest. ` +
        `A model under the vault would be committed and pushed. Set INTELIGIR_MODEL_DIR to a folder outside the vault.`,
    );
  }
}
