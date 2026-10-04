// What a switch of the desktop's vault may do, decided before anything moves: the shell asks it
// through the desktop entry, then stops the server, writes the selector and boots the next one. The
// selection rules themselves are `../server/vault-switch`, shared with `inteligir vault open`; this
// adds what only the app refuses.

import { existsSync } from "node:fs";
import path from "node:path";
import { physicalVaultDir } from "../server/config";
import { pathContains } from "../server/path-containment";
import { planVaultSelection, selectionRefusalMessage } from "../server/vault-switch";
import type { CurrentVault, VaultSelectionRefusal } from "../server/vault-switch";

// a vault that holds the app's data would commit and push it; one inside it would sit among it
type AppDataNesting = "holds-app-data" | "inside-app-data";

export type VaultSwitchRefusal = AppDataNesting | VaultSelectionRefusal;

// a folder not made yet is judged where it will land, through its nearest existing ancestor
const landingSpelling = (dir: string): string => {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved);
  return existsSync(resolved) || parent === resolved
    ? physicalVaultDir(resolved)
    : path.join(landingSpelling(parent), path.basename(resolved));
};

// a boot refuses this too, but in words for whoever pinned the launch, so the app asks first. the
// data folder itself counts as inside, since a folder within it is no better
export const appDataNesting = (vaultDir: string, rootDataDir: string): AppDataNesting | null => {
  const vault = landingSpelling(vaultDir);
  const appData = landingSpelling(rootDataDir);
  if (pathContains(appData, vault)) {
    return "inside-app-data";
  }
  return pathContains(vault, appData) ? "holds-app-data" : null;
};

export type VaultSwitchPlan = { kind: "switch" } | { kind: "refused"; reason: VaultSwitchRefusal };

export const planVaultSwitch = (
  current: CurrentVault & { rootDataDir: string },
  vaultDir: string,
): VaultSwitchPlan => {
  const selection = planVaultSelection(current, vaultDir);
  if (selection.kind === "refused") {
    return selection;
  }
  const nesting = appDataNesting(vaultDir, current.rootDataDir);
  return nesting === null ? selection : { kind: "refused", reason: nesting };
};

export const switchRefusalMessage = (reason: VaultSwitchRefusal): string => {
  switch (reason) {
    case "holds-app-data": {
      return "That folder holds Inteligir's own settings. Choose a folder inside it, or one elsewhere.";
    }
    case "inside-app-data": {
      return "That folder is inside Inteligir's own settings. Choose one elsewhere.";
    }
    default: {
      return selectionRefusalMessage(reason);
    }
  }
};
