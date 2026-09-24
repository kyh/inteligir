// The vault selector is the root config.json's `vaultDir`, and the shell's switch and
// `inteligir vault open` both move it: one plan and one set of sentences, so the two
// refuse the same things for the same reasons.

import { existsSync, statSync } from "node:fs";
import { physicalVaultDir, resolveAppConfig } from "./config";
import type { AppConfig, ResolveAppConfigArgs } from "./config";

export type VaultSelectionRefusal =
  | "vault-pinned-by-env"
  | "data-dir-pinned-by-env"
  | "already-open"
  | "not-a-directory";

export type CurrentVault = Pick<AppConfig, "vaultDir" | "vaultDirSource" | "dataDirSource">;

// what the env pins is not config.json's to change: the next boot reads the env first
export const selectionBlockedByEnv = (
  current: Pick<CurrentVault, "vaultDirSource" | "dataDirSource">,
): Extract<VaultSelectionRefusal, "vault-pinned-by-env" | "data-dir-pinned-by-env"> | null => {
  if (current.vaultDirSource === "env") {
    return "vault-pinned-by-env";
  }
  if (current.dataDirSource === "env") {
    return "data-dir-pinned-by-env";
  }
  return null;
};

export type VaultSelectionPlan =
  | { kind: "switch" }
  | { kind: "refused"; reason: VaultSelectionRefusal };

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// a vault is an existing folder: refused here, before a child is stopped or a selector written,
// so a recent vault on an unmounted drive is one sentence rather than a failed boot and a rollback
export const planVaultSelection = (current: CurrentVault, vaultDir: string): VaultSelectionPlan => {
  const blocked = selectionBlockedByEnv(current);
  if (blocked !== null) {
    return { kind: "refused", reason: blocked };
  }
  // physical on both sides: the shell asks with the path its picker returned, and the open
  // vault is the default's spelling or whatever config.json holds
  if (physicalVaultDir(vaultDir) === physicalVaultDir(current.vaultDir)) {
    return { kind: "refused", reason: "already-open" };
  }
  if (!isDirectory(vaultDir)) {
    return { kind: "refused", reason: "not-a-directory" };
  }
  return { kind: "switch" };
};

export const selectionRefusalMessage = (reason: VaultSelectionRefusal): string => {
  switch (reason) {
    case "vault-pinned-by-env": {
      return "INTELIGIR_VAULT_DIR chose the vault for this launch; unset it to switch from here.";
    }
    case "data-dir-pinned-by-env": {
      return "INTELIGIR_DATA_DIR pins one data dir for this launch, and a second vault would share it; unset it to switch from here.";
    }
    case "already-open": {
      return "That vault is already open.";
    }
    case "not-a-directory": {
      return "That vault is not an existing folder.";
    }
    // no default
  }
};

// a candidate is resolved exactly as a boot would resolve it, so every refusal a boot has
// (not absolute, nested in the data dir) is raised here, before anything is written. then
// again on the folder's physical spelling, which the selector stores, so one folder keeps one
// data dir however it was typed; the parse goes first so a `~/` path is expanded, and a
// relative one refused, before anything is realpathed. the data dir is keyed by the stored
// spelling, so one given that already keys a data dir the physical spelling lacks is kept as
// given: moving it would open that vault signed out, with no threads
export const resolveVaultCandidate = (args: ResolveAppConfigArgs, vaultDir: string): AppConfig => {
  const withVault = (dir: string): AppConfig =>
    resolveAppConfig({ ...args, env: { ...args.env, INTELIGIR_VAULT_DIR: dir } });
  const given = withVault(vaultDir);
  const physical = withVault(physicalVaultDir(given.vaultDir));
  return !existsSync(physical.dataDir) && existsSync(given.dataDir) ? given : physical;
};
