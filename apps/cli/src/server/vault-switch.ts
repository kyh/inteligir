// The vault selector is the root config.json's `vaultDir`, and the shell's switch and
// `inteligir vault open` both move it: one plan and one set of sentences, so the two
// refuse the same things for the same reasons.

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { type AppConfig, type ResolveAppConfigArgs, resolveAppConfig } from "./config";

export type VaultSelectionRefusal =
  | "vault-pinned-by-env"
  | "data-dir-pinned-by-env"
  | "already-open"
  | "not-a-directory";

export type CurrentVault = Pick<AppConfig, "vaultDir" | "vaultDirSource" | "dataDirSource">;

// what the env pins is not config.json's to change: the next boot reads the env first
export function selectionBlockedByEnv(
  current: Pick<CurrentVault, "vaultDirSource" | "dataDirSource">,
): Extract<VaultSelectionRefusal, "vault-pinned-by-env" | "data-dir-pinned-by-env"> | null {
  if (current.vaultDirSource === "env") return "vault-pinned-by-env";
  if (current.dataDirSource === "env") return "data-dir-pinned-by-env";
  return null;
}

export type VaultSelectionPlan =
  | { kind: "switch" }
  | { kind: "refused"; reason: VaultSelectionRefusal };

// a vault is an existing folder: refused here, before a child is stopped or a selector written,
// so a recent vault on an unmounted drive is one sentence rather than a failed boot and a rollback
export function planVaultSelection(current: CurrentVault, vaultDir: string): VaultSelectionPlan {
  const blocked = selectionBlockedByEnv(current);
  if (blocked !== null) return { kind: "refused", reason: blocked };
  if (resolve(vaultDir) === resolve(current.vaultDir)) {
    return { kind: "refused", reason: "already-open" };
  }
  if (!isDirectory(vaultDir)) return { kind: "refused", reason: "not-a-directory" };
  return { kind: "switch" };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function selectionRefusalMessage(reason: VaultSelectionRefusal): string {
  switch (reason) {
    case "vault-pinned-by-env":
      return "INTELIGIR_VAULT_DIR chose the vault for this launch; unset it to switch from here.";
    case "data-dir-pinned-by-env":
      return "INTELIGIR_DATA_DIR pins one data dir for this launch, and a second vault would share it; unset it to switch from here.";
    case "already-open":
      return "That vault is already open.";
    case "not-a-directory":
      return "That vault is not an existing folder.";
  }
}

// a candidate is resolved exactly as a boot would resolve it, so every refusal a boot has
// (not absolute, nested in the data dir) is raised here, before anything is written
export function resolveVaultCandidate(args: ResolveAppConfigArgs, vaultDir: string): AppConfig {
  return resolveAppConfig({ ...args, env: { ...args.env, INTELIGIR_VAULT_DIR: vaultDir } });
}
