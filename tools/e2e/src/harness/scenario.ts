import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchCloudWorker, type CloudWorker, type LaunchCloudWorkerArgs } from "./cloud-worker";
import { exec, hermeticProcessEnv } from "./exec";
import { launchApp, type AppInstance, type LaunchAppArgs } from "./instance";
import type { TrackedProcess } from "./tracked-child";

interface BootOptions {
  name: string;
  vaultRemote?: string;
  extraEnv?: Readonly<Record<string, string>>;
  // both run before boot; the app's repo init commits whatever it finds in the vault.
  seedVault?: (vaultDir: string) => Promise<void>;
  seedData?: (dataDir: string) => void | Promise<void>;
}

export interface ScenarioContext {
  repoRoot: string;
  scratchDir: string;
  log: (message: string) => void;
  boot(options: BootOptions): Promise<AppInstance>;
  bareRemote(name?: string): Promise<string>;
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
        register: (instance) => args.instances.push(instance),
      };
      // exactOptionalPropertyTypes: an absent option stays absent, never an explicit undefined.
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
