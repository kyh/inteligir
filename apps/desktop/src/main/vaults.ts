// A vault switch restarts the child the shell started; this owns what may be switched and
// what the shell remembers, over files a test can point at a temp dir. The plan itself is
// `inteligir/server/vault-switch`, shared with `inteligir vault open`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_FILE_NAME } from "inteligir/server/config";
import { stagedWriteFileSync } from "inteligir/server/staged-write";
import {
  planVaultSelection,
  selectionBlockedByEnv,
  selectionRefusalMessage,
} from "inteligir/server/vault-switch";
import type { VaultSelectionRefusal } from "inteligir/server/vault-switch";
import { toErrorMessage } from "../types";
import type { VaultRef } from "../vaults-state";
import type { ServerTarget } from "./server-instance";

export type VaultSwitchRefusal = "adopted-server" | VaultSelectionRefusal;

export interface SwitchContext {
  // false when the shell adopted a server it did not start: that one is nobody's to restart
  ownsServer: boolean;
  current: ServerTarget;
}

// what stands in the way before any folder is picked, or null
export const switchBlockedBy = (context: SwitchContext): VaultSwitchRefusal | null => {
  if (!context.ownsServer) {
    return "adopted-server";
  }
  return selectionBlockedByEnv(context.current);
};

export type VaultSwitchPlan = { kind: "switch" } | { kind: "refused"; reason: VaultSwitchRefusal };

export const planVaultSwitch = (context: SwitchContext, vaultDir: string): VaultSwitchPlan => {
  if (!context.ownsServer) {
    return { kind: "refused", reason: "adopted-server" };
  }
  return planVaultSelection(context.current, vaultDir);
};

export const switchRefusalMessage = (reason: VaultSwitchRefusal): string => {
  if (reason === "adopted-server") {
    return "This server was started outside the app, so the app cannot restart it on another vault. Stop it and reopen Inteligir to switch.";
  }
  return selectionRefusalMessage(reason);
};

// a refusal is decided before anything moves and answered as a value; a throw is a fault.
// a failure after the old child stopped is `reported`: by then the window that asked is closed,
// or the app is quitting, so main said it
export type VaultSwitchOutcome =
  | { ok: true }
  | { ok: false; reason: string }
  | { ok: false; reason: string; reported: true };

// the moves a planned switch makes, adapted in index.ts over the child, the root's config.json
// and the window; a test hands in fakes
export interface VaultSwitchPort {
  stopServer: () => Promise<void>;
  writeSelector: (vaultDir: string) => void;
  // re-read after the write rather than reused: the child boots on what config.json now says,
  // as the CLI would
  resolveTarget: () => ServerTarget;
  boot: (target: ServerTarget) => Promise<void>;
  closeRequestingWindow: () => void;
  reportFailure: (reason: string) => void;
  // nothing is running and nothing can put it back: main says why and quits
  abandon: (reason: string) => void;
  log: (message: string, cause: unknown) => void;
}

// a selector left naming the vault that failed would open it on the next launch, so a write
// that cannot put it back ends the app like a reopen that failed
const restorePrevious = async (
  port: VaultSwitchPort,
  previous: ServerTarget,
  selectorWritten: boolean,
): Promise<void> => {
  if (selectorWritten) {
    try {
      port.writeSelector(previous.vaultDir);
    } catch (error) {
      const selectorPath = path.join(previous.rootDataDir, CONFIG_FILE_NAME);
      throw new Error(
        `${selectorPath} could not be pointed back at ${previous.vaultDir}: ${toErrorMessage(error)}.`,
        { cause: error },
      );
    }
  }
  await port.stopServer();
  await port.boot(previous);
};

export const runVaultSwitch = async (
  port: VaultSwitchPort,
  previous: ServerTarget,
  vaultDir: string,
): Promise<VaultSwitchOutcome> => {
  await port.stopServer();
  // from here the old child is gone, so any throw must put the previous vault back
  let selectorWritten = false;
  try {
    port.writeSelector(vaultDir);
    selectorWritten = true;
    await port.boot(port.resolveTarget());
  } catch (error) {
    port.log("the vault did not open; returning to the previous one", error);
    try {
      await restorePrevious(port, previous, selectorWritten);
    } catch (reopenError) {
      const reason = `${toErrorMessage(reopenError)} Reopen Inteligir to continue.`;
      port.abandon(reason);
      return { ok: false, reason, reported: true };
    }
    port.closeRequestingWindow();
    const reason = `Could not open ${vaultDir}: ${toErrorMessage(error)}`;
    port.reportFailure(reason);
    return { ok: false, reason, reported: true };
  }
  port.closeRequestingWindow();
  return { ok: true };
};

export const vaultRef = (vaultPath: string): VaultRef => {
  const name = path.basename(vaultPath);
  return { name: name.length === 0 ? vaultPath : name, path: vaultPath };
};

export const RECENT_VAULTS_LIMIT = 8;

// newest first, one row per path
export const rememberVault = (recent: readonly string[], vaultPath: string): string[] =>
  [vaultPath, ...recent.filter((each) => each !== vaultPath)].slice(0, RECENT_VAULTS_LIMIT);

export const forgetVault = (recent: readonly string[], vaultPath: string): string[] =>
  recent.filter((each) => each !== vaultPath);

// what the menu and the page both offer: never the vault already open, and never a folder that
// is gone (an unmounted drive stays remembered, and is offered again once it is back)
export const offeredRecentVaults = (
  recent: readonly string[],
  current: string | null,
  exists: (vaultPath: string) => boolean,
): string[] => recent.filter((vaultPath) => vaultPath !== current && exists(vaultPath));

const recentVaultsFileSchema = z
  .object({ vaults: z.array(z.object({ path: z.string().min(1) }).strict()) })
  .strict();

// a convenience, not a store: bytes that are not a list read as nothing remembered, and say so,
// rather than refusing to boot over a file the user never wrote
export const readRecentVaults = (filePath: string, warn: (message: string) => void): string[] => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  try {
    return recentVaultsFileSchema.parse(JSON.parse(raw)).vaults.map((vault) => vault.path);
  } catch {
    warn(`${filePath} is not a recent-vaults list; starting over`);
    return [];
  }
};

export const writeRecentVaults = (filePath: string, recent: readonly string[]): void => {
  stagedWriteFileSync(
    filePath,
    `${JSON.stringify({ vaults: recent.map((vaultPath) => ({ path: vaultPath })) }, null, 2)}\n`,
  );
};
