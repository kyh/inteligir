// First run is decided before any server exists: a server is bound to one vault and one data dir,
// so the vault is chosen first, and the agent and the account follow as steps inside the app. This
// is the decision, pure over the resolution and a filesystem a test points at a temp dir; the shell
// asks it through the desktop entry and makes the moves, after checking the page named only folders
// it handed out.

import path from "node:path";
import { vaultNameProblem } from "@repo/contract/local/vault/vault-folder";
import type { FolderFacts, OwnSync } from "@repo/contract/local/vault/vault-folder";
import { physicalVaultDir } from "../server/config";
import type { VaultFolderFacts } from "../server/vault/folder-facts";
import type { ServerTarget, ServerTargetResult } from "./server-start";
import { appDataNesting, switchRefusalMessage } from "./vaults";

export type LaunchPlan =
  | { kind: "boot"; target: ServerTarget }
  // the target is the default vault, the one "Create a new vault" proposes
  | { kind: "first-run"; target: ServerTarget };

export interface LaunchArgs {
  target: ServerTarget;
  exists: (dir: string) => boolean;
}

// only a launch nothing chose a vault for, whose default vault is not there yet: an env pin, a
// selector in config.json or a default already made boots as it always has, so an upgrade, the
// CLI's own boots and a pinned harness never meet a first run
export const planLaunch = ({ target, exists }: LaunchArgs): LaunchPlan =>
  target.vaultDirSource === "default" &&
  target.dataDirSource === "default" &&
  !exists(target.vaultDir)
    ? { kind: "first-run", target }
    : { kind: "boot", target };

export interface ProposedVault {
  name: string;
  parent: string;
}

// the vault a launch before first run would have made, so choosing it as offered writes nothing
export const proposedNewVault = (launch: ServerTarget): ProposedVault => ({
  name: path.basename(launch.vaultDir),
  parent: path.dirname(launch.vaultDir),
});

// the page's choice, its folders already checked by the shell against what it handed out
export type FirstRunChoice =
  | { kind: "create"; name: string; parent: string }
  | { kind: "open"; path: string };

export interface FirstRunChoiceContext {
  exists: (dir: string) => boolean;
  // resolved exactly as a boot would, so every refusal a boot has is raised before anything moves
  resolve: (vaultDir: string) => ServerTargetResult;
  // what a launch with no selector opens: choosing it writes no selector
  defaultVaultDir: string;
  // where config.json and every vault's data dir live
  rootDataDir: string;
}

export type FirstRunPlan =
  | { kind: "refused"; reason: string }
  // `selector` is what config.json is pointed at, or null for the default vault
  | { kind: "open"; vaultDir: string; selector: string | null };

const openPlan = (context: FirstRunChoiceContext, vaultDir: string): FirstRunPlan => {
  // said here in the page's words: the resolver's own refusal is worded for whoever pinned a launch
  const nesting = appDataNesting(vaultDir, context.rootDataDir);
  if (nesting !== null) {
    return { kind: "refused", reason: switchRefusalMessage(nesting) };
  }
  const candidate = context.resolve(vaultDir);
  if (candidate.kind === "refused") {
    return { kind: "refused", reason: candidate.error };
  }
  const chosen = candidate.target.vaultDir;
  const isDefault = physicalVaultDir(chosen) === physicalVaultDir(context.defaultVaultDir);
  return { kind: "open", selector: isDefault ? null : chosen, vaultDir: chosen };
};

// the default's name in another case is the default on a volume that folds case, as a Mac's does,
// before the folder exists for a realpath to say so; kept apart, it would boot on a data dir of its
// own that the default's next boot never reads
const namesDefault = (context: FirstRunChoiceContext, vaultDir: string): boolean =>
  physicalVaultDir(path.dirname(vaultDir)) ===
    physicalVaultDir(path.dirname(context.defaultVaultDir)) &&
  path.basename(vaultDir).toLowerCase() === path.basename(context.defaultVaultDir).toLowerCase();

export const planFirstRunChoice = (
  choice: FirstRunChoice,
  context: FirstRunChoiceContext,
): FirstRunPlan => {
  if (choice.kind === "open") {
    if (!context.exists(choice.path)) {
      return { kind: "refused", reason: "That folder is not there any more." };
    }
    return openPlan(context, choice.path);
  }
  const problem = vaultNameProblem(choice.name);
  if (problem !== null) {
    return { kind: "refused", reason: problem };
  }
  const name = choice.name.trim();
  const vaultDir = path.join(choice.parent, name);
  if (context.exists(vaultDir)) {
    return {
      kind: "refused",
      reason: `There is already a folder named ${name} there. Pick another name, or open that folder instead.`,
    };
  }
  if (namesDefault(context, vaultDir)) {
    return { kind: "open", selector: null, vaultDir: context.defaultVaultDir };
  }
  return openPlan(context, vaultDir);
};

// git's own reading of a remote: `://` is a url, a colon before any slash is `user@host:path`,
// anything else a path on this machine
const SCP_LIKE_HOST = /^(?:[^@/]+@)?(?<host>[^/:@]+):/u;

export const ownSyncOf = (remote: string): OwnSync => {
  if (remote.includes("://")) {
    let hostname = "";
    try {
      ({ hostname } = new URL(remote));
    } catch {
      return { kind: "local" };
    }
    return hostname === "" ? { kind: "local" } : { host: hostname, kind: "host" };
  }
  const host = SCP_LIKE_HOST.exec(remote)?.groups?.host;
  return host === undefined ? { kind: "local" } : { host, kind: "host" };
};

// what the page shows of a picked folder; a folder gone between the pick and the look has nothing
export const folderFactsOf = (facts: VaultFolderFacts): FolderFacts =>
  facts.exists
    ? {
        externalSync: facts.externalSync,
        noteCount: facts.noteCount,
        ownSync: facts.remote === null ? null : ownSyncOf(facts.remote),
      }
    : { externalSync: facts.externalSync, noteCount: { capped: false, count: 0 }, ownSync: null };
