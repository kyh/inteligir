// The scenario contract and its per-run context: scratch dirs, instance
// boots (auto-torn-down by the runner), and git remote fixtures.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { exec, hermeticProcessEnv } from "./exec";
import { launchApp, type AppInstance, type LaunchAppArgs } from "./instance";

interface BootOptions {
  /** Short label, unique within the scenario ("a", "b", "solo"). */
  name: string;
  vaultRemote?: string;
  extraEnv?: Readonly<Record<string, string>>;
  /** Seeds fixture files into the vault dir BEFORE boot; the app's repo init
   *  commits whatever it finds there. */
  seedVault?: (vaultDir: string) => Promise<void>;
}

/**
 * What the runner's teardown and failure transcript need from a long-lived
 * child — the slice of AppInstance the runner actually reads, so a non-app
 * process (the cloud dev Worker) rides the same registry: stopped in reverse
 * launch order, counted in `teardownClean` (a group surviving SIGKILL keeps
 * the scratch), and its output tail printed on failure.
 */
export interface TrackedProcess {
  name: string;
  outputTail(lines?: number): string;
  stop(): Promise<void>;
}

export interface ScenarioContext {
  repoRoot: string;
  /** This scenario's own scratch dir; removed by the runner unless --keep. */
  scratchDir: string;
  log: (message: string) => void;
  boot(options: BootOptions): Promise<AppInstance>;
  /** A scratch bare git repo; returns the file:// URL for INTELIGIR_VAULT_REMOTE. */
  bareRemote(name?: string): Promise<string>;
  /** Hand a non-app process to the runner's teardown registry. */
  track(process: TrackedProcess): void;
}

export interface Scenario {
  name: string;
  description: string;
  run(context: ScenarioContext): Promise<void>;
}

export interface CreateScenarioContextArgs {
  repoRoot: string;
  scratchDir: string;
  log: (message: string) => void;
  /** The runner's teardown registry; every boot lands here. */
  instances: TrackedProcess[];
}

export function createScenarioContext(args: CreateScenarioContextArgs): ScenarioContext {
  return {
    repoRoot: args.repoRoot,
    scratchDir: args.scratchDir,
    log: args.log,
    async boot(options) {
      const instanceDir = join(args.scratchDir, options.name);
      const vaultDir = join(instanceDir, "vault");
      if (options.seedVault) {
        await mkdir(vaultDir, { recursive: true });
        await options.seedVault(vaultDir);
      }
      const launchArgs: LaunchAppArgs = {
        name: options.name,
        instanceDir,
        repoRoot: args.repoRoot,
        onLog: args.log,
        // Registered at spawn, BEFORE the health wait, so the runner's
        // teardown owns the process group through every early-exit path.
        register: (instance) => args.instances.push(instance),
      };
      // Assigned only when set: an absent option must stay absent rather than
      // arrive as an explicit `undefined` the launcher reads as configured.
      if (options.vaultRemote !== undefined) launchArgs.vaultRemote = options.vaultRemote;
      if (options.extraEnv !== undefined) launchArgs.extraEnv = options.extraEnv;
      return launchApp(launchArgs);
    },
    track(process) {
      args.instances.push(process);
    },
    async bareRemote(name = "remote") {
      const remoteDir = join(args.scratchDir, `${name}.git`);
      await mkdir(remoteDir, { recursive: true });
      await exec("git", ["init", "--bare", "-b", "main", remoteDir], {
        env: hermeticProcessEnv(),
      });
      args.log(`bare remote at ${remoteDir}`);
      return `file://${remoteDir}`;
    },
  };
}
