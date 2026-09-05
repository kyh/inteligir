// A vault switch restarts the child the shell started; this owns what may be switched and
// what the shell remembers, over files a test can point at a temp dir.

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { stagedWriteFileSync } from "inteligir/server/staged-write";
import type { VaultRef } from "../vaults-state";
import type { ServerTarget } from "./server-instance";

export type VaultSwitchRefusal =
  | "adopted-server"
  | "vault-pinned-by-env"
  | "data-dir-pinned-by-env"
  | "already-open";

export interface SwitchContext {
  // false when the shell adopted a server it did not start: that one is nobody's to restart
  ownsServer: boolean;
  current: ServerTarget;
}

// what stands in the way before any folder is picked, or null
export function switchBlockedBy(context: SwitchContext): VaultSwitchRefusal | null {
  if (!context.ownsServer) return "adopted-server";
  if (context.current.vaultDirSource === "env") return "vault-pinned-by-env";
  if (context.current.dataDirSource === "env") return "data-dir-pinned-by-env";
  return null;
}

export type VaultSwitchPlan = { kind: "switch" } | { kind: "refused"; reason: VaultSwitchRefusal };

export function planVaultSwitch(context: SwitchContext, vaultDir: string): VaultSwitchPlan {
  const blocked = switchBlockedBy(context);
  if (blocked !== null) return { kind: "refused", reason: blocked };
  if (resolve(vaultDir) === resolve(context.current.vaultDir)) {
    return { kind: "refused", reason: "already-open" };
  }
  return { kind: "switch" };
}

export function switchRefusalMessage(reason: VaultSwitchRefusal): string {
  switch (reason) {
    case "adopted-server":
      return "This server was started outside the app, so the app cannot restart it on another vault. Stop it and reopen Inteligir to switch.";
    case "vault-pinned-by-env":
      return "INTELIGIR_VAULT_DIR chose the vault for this launch; unset it to switch from here.";
    case "data-dir-pinned-by-env":
      return "INTELIGIR_DATA_DIR pins one data dir for this launch, and a second vault would share it; unset it to switch from here.";
    case "already-open":
      return "That vault is already open.";
  }
}

export function vaultRef(path: string): VaultRef {
  const name = basename(path);
  return { path, name: name.length === 0 ? path : name };
}

export const RECENT_VAULTS_LIMIT = 8;

// newest first, one row per path
export function rememberVault(recent: readonly string[], path: string): string[] {
  return [path, ...recent.filter((each) => each !== path)].slice(0, RECENT_VAULTS_LIMIT);
}

export function forgetVault(recent: readonly string[], path: string): string[] {
  return recent.filter((each) => each !== path);
}

const recentVaultsFileSchema = z
  .object({ vaults: z.array(z.object({ path: z.string().min(1) }).strict()) })
  .strict();

// a convenience, not a store: bytes that are not a list read as nothing remembered, and say so,
// rather than refusing to boot over a file the user never wrote
export function readRecentVaults(filePath: string, warn: (message: string) => void): string[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  try {
    return recentVaultsFileSchema.parse(JSON.parse(raw)).vaults.map((vault) => vault.path);
  } catch {
    warn(`${filePath} is not a recent-vaults list; starting over`);
    return [];
  }
}

export function writeRecentVaults(filePath: string, recent: readonly string[]): void {
  stagedWriteFileSync(
    filePath,
    `${JSON.stringify({ vaults: recent.map((path) => ({ path })) }, null, 2)}\n`,
  );
}
