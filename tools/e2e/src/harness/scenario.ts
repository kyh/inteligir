import { mkdir } from "node:fs/promises";
import path from "node:path";
import { launchCloudWorker } from "./cloud-worker";
import type { CloudWorker, LaunchCloudWorkerArgs } from "./cloud-worker";
import { exec, hermeticProcessEnv } from "./exec";
import { launchApp } from "./instance";
import type { AppInstance, LaunchAppArgs } from "./instance";
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
  boot: (options: BootOptions) => Promise<AppInstance>;
  bareRemote: (name?: string) => Promise<string>;
  cloudWorker: (options?: { builtConfig?: string }) => Promise<CloudWorker>;
}

export interface Scenario {
  name: string;
  description: string;
  run: (context: ScenarioContext) => Promise<void>;
}

export interface CreateScenarioContextArgs {
  repoRoot: string;
  scratchDir: string;
  log: (message: string) => void;
  instances: TrackedProcess[];
}

export const createScenarioContext = (args: CreateScenarioContextArgs): ScenarioContext => ({
  async bareRemote(name = "remote") {
    const remoteDir = path.join(args.scratchDir, `${name}.git`);
    await mkdir(remoteDir, { recursive: true });
    await exec("git", ["init", "--bare", "-b", "main", remoteDir], {
      env: hermeticProcessEnv(),
    });
    args.log(`bare remote at ${remoteDir}`);
    return `file://${remoteDir}`;
  },
  async boot(options) {
    const instanceDir = path.join(args.scratchDir, options.name);
    if (options.seedVault) {
      const vaultDir = path.join(instanceDir, "vault");
      await mkdir(vaultDir, { recursive: true });
      await options.seedVault(vaultDir);
    }
    if (options.seedData) {
      const dataDir = path.join(instanceDir, "data");
      await mkdir(dataDir, { recursive: true });
      await options.seedData(dataDir);
    }
    const launchArgs: LaunchAppArgs = {
      instanceDir,
      name: options.name,
      onLog: args.log,
      register: (instance) => {
        args.instances.push(instance);
      },
      repoRoot: args.repoRoot,
    };
    // exactOptionalPropertyTypes: an absent option stays absent, never an explicit undefined.
    if (options.vaultRemote !== undefined) {
      launchArgs.vaultRemote = options.vaultRemote;
    }
    if (options.extraEnv !== undefined) {
      launchArgs.extraEnv = options.extraEnv;
    }
    return await launchApp(launchArgs);
  },
  async cloudWorker(options) {
    const launch: LaunchCloudWorkerArgs = {
      onLog: args.log,
      register: (process) => {
        args.instances.push(process);
      },
      repoRoot: args.repoRoot,
      scratchDir: args.scratchDir,
    };
    if (options?.builtConfig !== undefined) {
      launch.builtConfig = options.builtConfig;
    }
    return await launchCloudWorker(launch);
  },
  log: args.log,
  repoRoot: args.repoRoot,
  scratchDir: args.scratchDir,
});
