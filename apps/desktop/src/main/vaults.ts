// A vault switch restarts the child the shell started; this owns what may be switched and
// what the shell remembers, over files a test can point at a temp dir. The plan itself is
// `inteligir/server/vault-switch`, shared with `inteligir vault open`.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { stagedWriteFileSync } from "inteligir/server/staged-write";
import {
  planVaultSelection,
  selectionBlockedByEnv,
  selectionRefusalMessage,
  type VaultSelectionRefusal,
} from "inteligir/server/vault-switch";
import type { VaultRef } from "../vaults-state";
import type { ServerTarget } from "./server-instance";

export type VaultSwitchRefusal = "adopted-server" | VaultSelectionRefusal;

export interface SwitchContext {
  // false when the shell adopted a server it did not start: that one is nobody's to restart
  ownsServer: boolean;
  current: ServerTarget;
}

// what stands in the way before any folder is picked, or null
export function switchBlockedBy(context: SwitchContext): VaultSwitchRefusal | null {
  if (!context.ownsServer) return "adopted-server";
  return selectionBlockedByEnv(context.current);
}

export type VaultSwitchPlan = { kind: "switch" } | { kind: "refused"; reason: VaultSwitchRefusal };

export function planVaultSwitch(context: SwitchContext, vaultDir: string): VaultSwitchPlan {
  if (!context.ownsServer) return { kind: "refused", reason: "adopted-server" };
  return planVaultSelection(context.current, vaultDir);
}

export function switchRefusalMessage(reason: VaultSwitchRefusal): string {
  if (reason === "adopted-server") {
    return "This server was started outside the app, so the app cannot restart it on another vault. Stop it and reopen Inteligir to switch.";
  }
  return selectionRefusalMessage(reason);
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
