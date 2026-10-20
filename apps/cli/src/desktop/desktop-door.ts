// The questions the desktop shell asks the CLI. The shell is Rust, and every rule it acts by that is
// the server's own is the TypeScript here, so none is spelled twice: which vault a launch boots,
// what a first run's choice opens, whether a switch may go ahead, a folder's facts, the selector's
// write, a browser's sign-in. Each answers `{ answer }`, or `{ reason }` for a refusal in the
// person's words; anything thrown is a fault. desktop-entry.ts asks one per process.

import { existsSync } from "node:fs";
import path from "node:path";
import { outsideSyncWarning } from "@repo/contract/local/vault/vault-folder";
import type { FolderFacts } from "@repo/contract/local/vault/vault-folder";
import { packageFile, readCliVersion } from "../paths";
import { readManagedVaultDir, runtimeModeOf, writeManagedVaultDir } from "../server/config";
import { selectionBlockedByEnv, selectionRefusalMessage } from "../server/vault-switch";
import { folderExternalSync, inspectVaultFolder } from "../server/vault/folder-facts";
import {
  bundledGitEnv,
  bundledGitReasonText,
  isExecutableFile,
  printDeveloperDir,
  printHostGitVersion,
  resolveGit,
} from "./bundled-git";
import { folderFactsOf, planFirstRunChoice, planLaunch, proposedNewVault } from "./first-run";
import type { FirstRunChoice, FirstRunPlan, LaunchPlan, ProposedVault } from "./first-run";
import { isDirectory, resolveShellPath, runShell } from "./login-shell-path";
import {
  browserSignInUrl,
  describeServerVerdict,
  folderFactsContext,
  resolveServerTarget,
  verifyServer,
} from "./server-start";
import type { ResolveServerTargetArgs, ServerTarget } from "./server-start";
import { planVaultSwitch, switchRefusalMessage } from "./vaults";

export type DoorReply<T> = { answer: T } | { reason: string };

export interface DoorContext {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

export const doorTargetArgs = (
  context: DoorContext,
  vaultDir?: string,
): ResolveServerTargetArgs => {
  const args: ResolveServerTargetArgs = { env: context.env, homeDir: context.homeDir };
  if (vaultDir !== undefined) {
    args.vaultDir = vaultDir;
  }
  return args;
};

const describeTarget = (target: ServerTarget) => {
  const blocked = selectionBlockedByEnv(target);
  return {
    dataDir: target.dataDir,
    rootDataDir: target.rootDataDir,
    switchBlocked: blocked === null ? null : selectionRefusalMessage(blocked),
    vaultDir: target.vaultDir,
  };
};

type DoorTarget = ReturnType<typeof describeTarget>;
type DoorOpening = Omit<Extract<FirstRunPlan, { kind: "open" }>, "kind">;

// what each question answers: the shell's serde types in launch.rs read these, held to them by the
// door's test schemas (test-support/door-answers.ts) and tools/repo-guards/src/desktop-shell-wire.test.ts
export interface DoorAnswers {
  launch: {
    env: Record<string, string>;
    notes: string[];
    plan: LaunchPlan["kind"];
    proposal: ProposedVault;
    target: DoorTarget;
  };
  facts: FolderFacts;
  sync: {
    externalSync: ReturnType<typeof folderExternalSync>;
    warning: ReturnType<typeof outsideSyncWarning> | null;
  };
  "plan-open": DoorOpening;
  "plan-create": DoorOpening;
  "plan-switch": DoorOpening;
  select: DoorTarget;
  handoff: { url: string };
}

export type DoorVerb = keyof DoorAnswers;

// the login shell's PATH and the git the Mac should run, answered as what every node child the
// shell starts after runs with, and the vault the launch boots or the first run that comes first
const launch = async (context: DoorContext): Promise<DoorReply<DoorAnswers["launch"]>> => {
  const mode = runtimeModeOf(context.env);
  const notes: string[] = [];
  const env: Record<string, string> = {};
  const shellPath = await resolveShellPath({
    env: context.env,
    homeDir: context.homeDir,
    isDirectory,
    mode,
    platform: process.platform,
    run: runShell,
  });
  if (shellPath.source !== "inherited") {
    if (shellPath.source === "fallback") {
      notes.push(
        `could not read the login shell's PATH (${shellPath.reason}); adding the usual install dirs instead`,
      );
    }
    env.PATH = shellPath.path;
  }
  const searchPath = env.PATH ?? context.env.PATH;
  const git = await resolveGit({
    isExecutableFile,
    mode,
    printDeveloperDir,
    // the git the server would run, found on the PATH it runs with
    printHostGitVersion: async () => await printHostGitVersion(searchPath),
    // the bundle's Resources, where the CLI sits beside the git it ships
    resourcesPath: path.dirname(packageFile(".")),
  });
  if (git.source === "bundled") {
    notes.push(`${bundledGitReasonText(git.why)}; the server runs ${git.root}`);
  }
  Object.assign(env, bundledGitEnv(git, searchPath));
  const resolved = resolveServerTarget(doorTargetArgs(context));
  if (resolved.kind === "refused") {
    return { reason: resolved.error };
  }
  return {
    answer: {
      env,
      notes,
      plan: planLaunch({ exists: existsSync, target: resolved.target }).kind,
      proposal: proposedNewVault(resolved.target),
      target: describeTarget(resolved.target),
    },
  };
};

// what the first-run page shows of a picked folder
const facts = async (
  context: DoorContext,
  dir: string,
): Promise<DoorReply<DoorAnswers["facts"]>> => ({
  answer: folderFactsOf(await inspectVaultFolder(dir, folderFactsContext(doorTargetArgs(context)))),
});

// where the folder already syncs, and the sentences a confirmation says about it; neither counts
// notes nor asks git, since the boot says whatever else is wrong with the folder
const sync = (context: DoorContext, dir: string): DoorReply<DoorAnswers["sync"]> => {
  const externalSync = folderExternalSync(dir, context.homeDir);
  return {
    answer: {
      externalSync,
      warning: externalSync === null ? null : outsideSyncWarning(externalSync),
    },
  };
};

const planChoice = (context: DoorContext, choice: FirstRunChoice): DoorReply<DoorOpening> => {
  const launched = resolveServerTarget(doorTargetArgs(context));
  if (launched.kind === "refused") {
    return { reason: launched.error };
  }
  const plan = planFirstRunChoice(choice, {
    defaultVaultDir: launched.target.vaultDir,
    exists: existsSync,
    resolve: (vaultDir) => resolveServerTarget(doorTargetArgs(context, vaultDir)),
    rootDataDir: launched.target.rootDataDir,
  });
  return plan.kind === "refused"
    ? { reason: plan.reason }
    : { answer: { selector: plan.selector, vaultDir: plan.vaultDir } };
};

// refused and resolved exactly as a boot would, before anything moves
const planSwitch = (context: DoorContext, dir: string): DoorReply<DoorOpening> => {
  const current = resolveServerTarget(doorTargetArgs(context));
  if (current.kind === "refused") {
    return { reason: current.error };
  }
  const plan = planVaultSwitch(current.target, dir);
  if (plan.kind === "refused") {
    return { reason: switchRefusalMessage(plan.reason) };
  }
  const candidate = resolveServerTarget(doorTargetArgs(context, dir));
  return candidate.kind === "refused"
    ? { reason: candidate.error }
    : { answer: { selector: candidate.target.vaultDir, vaultDir: candidate.target.vaultDir } };
};

// config.json's selector (null clears it, so the next launch is a first run again), and the vault
// the next boot resolves, re-read after the write as a boot would
// a selection the boot's own resolution then refuses is taken back, so a refusal always leaves the
// selector as it found it: the shell puts back a selector only after a boot that failed
const select = (context: DoorContext, vaultDir: string | null): DoorReply<DoorTarget> => {
  const current = resolveServerTarget(doorTargetArgs(context));
  if (current.kind === "refused") {
    return { reason: current.error };
  }
  const { rootDataDir } = current.target;
  const previous = readManagedVaultDir(rootDataDir);
  writeManagedVaultDir(rootDataDir, vaultDir);
  const next = resolveServerTarget(doorTargetArgs(context));
  if (next.kind === "refused") {
    writeManagedVaultDir(rootDataDir, previous);
    return { reason: next.error };
  }
  return { answer: describeTarget(next.target) };
};

// a browser holds no bearer, so "Open in Browser" signs one in through a handoff
const handoff = async (context: DoorContext): Promise<DoorReply<DoorAnswers["handoff"]>> => {
  const resolved = resolveServerTarget(doorTargetArgs(context));
  if (resolved.kind === "refused") {
    return { reason: resolved.error };
  }
  const { dataDir } = resolved.target;
  const verdict = await verifyServer(dataDir, readCliVersion());
  return verdict.kind === "verified"
    ? { answer: { url: await browserSignInUrl(verdict.live) } }
    : { reason: describeServerVerdict(verdict, dataDir) };
};

const required = (value: string | undefined, name: string): string => {
  if (value === undefined || value === "") {
    throw new Error(`the desktop entry needs ${name}`);
  }
  return value;
};

type DoorQuestion<V extends DoorVerb> = (
  context: DoorContext,
  args: readonly string[],
) => DoorReply<DoorAnswers[V]> | Promise<DoorReply<DoorAnswers[V]>>;

// mapped, so a question looked up by a generic verb answers that verb's own type
type DoorQuestions = { [V in DoorVerb]: DoorQuestion<V> };

const QUESTIONS: DoorQuestions = {
  facts: async (context, args) => await facts(context, required(args[0], "a folder")),
  handoff: async (context) => await handoff(context),
  launch: async (context) => await launch(context),
  "plan-create": (context, args) =>
    planChoice(context, {
      kind: "create",
      name: args[1] ?? "",
      parent: required(args[0], "a parent folder"),
    }),
  "plan-open": (context, args) =>
    planChoice(context, { kind: "open", path: required(args[0], "a folder") }),
  "plan-switch": (context, args) => planSwitch(context, required(args[0], "a folder")),
  select: (context, args) =>
    select(context, args[0] === "--default" ? null : required(args[0], "a folder")),
  sync: (context, args) => sync(context, required(args[0], "a folder")),
};

const isDoorVerb = (verb: string): verb is DoorVerb => Object.hasOwn(QUESTIONS, verb);

export const parseDoorVerb = (verb: string | undefined): DoorVerb => {
  if (verb === undefined || !isDoorVerb(verb)) {
    throw new Error(`the desktop entry answers no "${String(verb)}"`);
  }
  return verb;
};

export const answerDoor = async <V extends DoorVerb>(
  context: DoorContext,
  verb: V,
  args: readonly string[],
): Promise<DoorReply<DoorAnswers[V]>> => await QUESTIONS[verb](context, args);
