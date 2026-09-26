// First run is decided here, before any server exists: a server is bound to one vault and one data
// dir, so the vault is chosen first, and the agent and the account follow as steps inside the app.
// Pure over the resolution and a filesystem a test points at a temp dir; index.ts adapts it over
// the window, the child and the root's config.json, as it does the vault switch.

import path from "node:path";
import { physicalVaultDir } from "inteligir/server/config";
import type { VaultFolderFacts } from "inteligir/server/vault/folder-facts";
import { vaultNameProblem } from "../first-run-state";
import type { FirstRunChoice, FirstRunState, FolderFacts, OwnSync } from "../first-run-state";
import { toErrorMessage } from "../types";
import type { ServerTarget, ServerTargetResult } from "./server-instance";

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

// the vault a launch before first run would have made, so choosing it as offered writes nothing
export const proposedNewVault = (launch: ServerTarget): FirstRunState["newVault"] => ({
  name: path.basename(launch.vaultDir),
  parent: path.dirname(launch.vaultDir),
});

// every folder the page may name back is one main handed it: the proposal's parent and each pick
export interface HandedOut {
  parents: ReadonlySet<string>;
  folders: ReadonlySet<string>;
}

export interface FirstRunChoiceContext {
  handedOut: HandedOut;
  exists: (dir: string) => boolean;
  // resolved exactly as a boot would, so every refusal a boot has is raised before anything moves
  resolve: (vaultDir: string) => ServerTargetResult;
  // what a launch with no selector opens: choosing it writes no selector
  defaultVaultDir: string;
}

export type FirstRunPlan =
  | { kind: "refused"; reason: string }
  // `selector` is what config.json is pointed at, or null for the default vault
  | { kind: "open"; vaultDir: string; selector: string | null };

export type OpenPlan = Extract<FirstRunPlan, { kind: "open" }>;

const openPlan = (context: FirstRunChoiceContext, vaultDir: string): FirstRunPlan => {
  const candidate = context.resolve(vaultDir);
  if (candidate.kind === "refused") {
    return { kind: "refused", reason: candidate.error };
  }
  const chosen = candidate.target.vaultDir;
  const isDefault = physicalVaultDir(chosen) === physicalVaultDir(context.defaultVaultDir);
  return { kind: "open", selector: isDefault ? null : chosen, vaultDir: chosen };
};

export const planFirstRunChoice = (
  choice: FirstRunChoice,
  context: FirstRunChoiceContext,
): FirstRunPlan => {
  if (choice.kind === "open") {
    if (!context.handedOut.folders.has(choice.path)) {
      return { kind: "refused", reason: "That folder is not one the app offered." };
    }
    if (!context.exists(choice.path)) {
      return { kind: "refused", reason: "That folder is not there any more." };
    }
    return openPlan(context, choice.path);
  }
  if (!context.handedOut.parents.has(choice.parent)) {
    return { kind: "refused", reason: "That location is not one the app offered." };
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
  return openPlan(context, vaultDir);
};

// the moves a planned first run makes, adapted in index.ts; a test hands in fakes
export interface FirstRunPort {
  // null removes the selector, so the next launch is a first run again
  writeSelector: (vaultDir: string | null) => void;
  // re-read after the write rather than reused: the child boots on what config.json now says,
  // as the CLI would
  resolveTarget: () => ServerTarget;
  boot: (target: ServerTarget) => Promise<void>;
  // whatever a failed boot left running
  stopServer: () => Promise<void>;
  log: (message: string, cause: unknown) => void;
}

// the page stays on a failure, so the reason is answered to it as a value
export type FirstRunOutcome = { ok: true } | { ok: false; reason: string };

// a selector left naming a vault that failed would open it on the next launch, with no first run
// to choose again, so a failed boot takes it back out
const undoSelector = (port: FirstRunPort, written: boolean): string => {
  if (!written) {
    return "";
  }
  try {
    port.writeSelector(null);
    return "";
  } catch (error) {
    port.log("the vault selector could not be cleared", error);
    return ` The next launch will try it again (${toErrorMessage(error)}).`;
  }
};

export const runFirstRun = async (port: FirstRunPort, plan: OpenPlan): Promise<FirstRunOutcome> => {
  let written = false;
  try {
    if (plan.selector !== null) {
      port.writeSelector(plan.selector);
      written = true;
    }
    await port.boot(port.resolveTarget());
    return { ok: true };
  } catch (error) {
    port.log("the first vault did not open", error);
    try {
      await port.stopServer();
    } catch (stopError) {
      port.log("the failed boot's server did not stop", stopError);
    }
    const residue = undoSelector(port, written);
    return {
      ok: false,
      reason: `Could not open ${plan.vaultDir}: ${toErrorMessage(error)}${residue}`,
    };
  }
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
