// The scenario contract and its per-run context: scratch dirs, instance
// boots (auto-torn-down by the runner), and git remote fixtures.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchCloudWorker, type CloudWorker, type LaunchCloudWorkerArgs } from "./cloud-worker";
import { exec, hermeticProcessEnv } from "./exec";
import { launchApp, type AppInstance, type LaunchAppArgs } from "./instance";
import type { TrackedProcess } from "./tracked-child";

interface BootOptions {
  /** Short label, unique within the scenario ("a", "b", "solo"). */
  name: string;
  vaultRemote?: string;
  extraEnv?: Readonly<Record<string, string>>;
  /** Seeds fixture files into the vault dir BEFORE boot; the app's repo init
   *  commits whatever it finds there. */
  seedVault?: (vaultDir: string) => Promise<void>;
  /** Seeds the data dir BEFORE boot — a device credential, so the instance
   *  boots already paired. A hook rather than a path the scenario builds,
   *  because the instance layout is the launcher's own. */
  seedData?: (dataDir: string) => void | Promise<void>;
}

export interface ScenarioContext {
  repoRoot: string;
  /** This scenario's own scratch dir; removed by the runner unless --keep. */
  scratchDir: string;
  log: (message: string) => void;
  boot(options: BootOptions): Promise<AppInstance>;
  /** A scratch bare git repo; returns the file:// URL for INTELIGIR_VAULT_REMOTE. */
  bareRemote(name?: string): Promise<string>;
  /** The product Worker on a scratch persist dir — the REAL cloud, for the
   *  scenarios that need one. Registered for teardown like an instance.
   *  `builtConfig` boots the vite-emitted deploy artifact instead of the
   *  source entry. */
  cloudWorker(options?: { builtConfig?: string }): Promise<CloudWorker>;
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
      if (options.seedVault) {
        const vaultDir = join(instanceDir, "vault");
        await mkdir(vaultDir, { recursive: true });
        await options.seedVault(vaultDir);
      }
      if (options.seedData) {
        const dataDir = join(instanceDir, "data");
        await mkdir(dataDir, { recursive: true });
        await options.seedData(dataDir);
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
    cloudWorker(options) {
      const launch: LaunchCloudWorkerArgs = {
        repoRoot: args.repoRoot,
        scratchDir: args.scratchDir,
        onLog: args.log,
        register: (process) => args.instances.push(process),
      };
      // Assigned only when set — same rule as boot() above.
      if (options?.builtConfig !== undefined) launch.builtConfig = options.builtConfig;
      return launchCloudWorker(launch);
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
