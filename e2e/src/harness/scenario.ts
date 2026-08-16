// The scenario contract and its per-run context: scratch dirs, instance
// boots (auto-torn-down by the runner), and git remote fixtures.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { exec, hermeticProcessEnv } from "./exec";
import { launchApp, type AppInstance, type BootMode } from "./instance";

interface BootOptions {
  /** Short label, unique within the scenario ("a", "b", "solo"). */
  name: string;
  vaultRemote?: string;
  extraEnv?: Readonly<Record<string, string>>;
  /** Seeds fixture files into the vault dir BEFORE boot; the app's repo init
   *  commits whatever it finds there. */
  seedVault?: (vaultDir: string) => Promise<void>;
}

export interface ScenarioContext {
  mode: BootMode;
  repoRoot: string;
  /** This scenario's own scratch dir; removed by the runner unless --keep. */
  scratchDir: string;
  log: (message: string) => void;
  boot(options: BootOptions): Promise<AppInstance>;
  /** A scratch bare git repo; returns the file:// URL for INTELIGIR_VAULT_REMOTE. */
  bareRemote(name?: string): Promise<string>;
}

export interface Scenario {
  name: string;
  description: string;
  run(context: ScenarioContext): Promise<void>;
}

export interface CreateScenarioContextArgs {
  mode: BootMode;
  repoRoot: string;
  scratchDir: string;
  log: (message: string) => void;
  /** The runner's teardown registry; every boot lands here. */
  instances: AppInstance[];
}

export function createScenarioContext(args: CreateScenarioContextArgs): ScenarioContext {
  return {
    mode: args.mode,
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
      return launchApp({
        mode: args.mode,
        name: options.name,
        instanceDir,
        repoRoot: args.repoRoot,
        onLog: args.log,
        // Registered at spawn, BEFORE the health wait, so the runner's
        // teardown owns the process group through every early-exit path.
        register: (instance) => args.instances.push(instance),
        ...(options.vaultRemote === undefined ? {} : { vaultRemote: options.vaultRemote }),
        ...(options.extraEnv === undefined ? {} : { extraEnv: options.extraEnv }),
      });
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
