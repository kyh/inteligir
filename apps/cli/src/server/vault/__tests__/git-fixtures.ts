// What the git suites share: scratch repos and remotes, an engine over one, and the reads that
// check what a step left behind. Every git here, and every git the server under test runs, goes
// through one hermetic runner.

import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";
import { expect, onTestFinished } from "vitest";
import { ensureVaultRepo, SEED_COMMIT_KEY } from "../git-bootstrap";
import type { EnsureVaultRepoArgs } from "../git-bootstrap";
import { createGitEngine } from "../git-engine";
import type { GitEngine, GitEngineArgs } from "../git-engine";
import type { Reconcile } from "../git-merge";
import { gitAt, gitPath, identityEnv } from "../git-run";
import type { RunGitOptions } from "../git-run";
import type { VaultFilesChange } from "../vault-changes";
import { makeTempDir } from "../../__tests__/temp-dir";
import { hermeticGit } from "./git-test-env";

export const git = hermeticGit();

export const scratchDir = (prefix: string): string => makeTempDir(prefix);

export const makeBareRemote = async (): Promise<string> => {
  const dir = scratchDir("inteligir-git-remote-");
  await git.run(dir, ["init", "--bare", "-b", "main"]);
  return dir;
};

export const initVault = async (root: string): Promise<void> => {
  await ensureVaultRepo({ git, root });
};

export interface AutoCommitTiming {
  quietMs: number;
  maxWaitMs: number;
}

export const TEST_DEVICE = "Test Device";

export const makeEngine = async (args: {
  remoteUrl: string | null;
  timing?: AutoCommitTiming;
  // the engine's own git config rows, over the hermetic ones; the bootstrap runs without them
  env?: Record<string, string>;
  root?: string;
  // also the bootstrap's committer, so two devices' first commits are two histories
  device?: string;
  reconcile?: Reconcile;
  // given, the vault is a folder the bootstrap creates and seeds, unless `root` already exists
  seed?: EnsureVaultRepoArgs["seed"];
}): Promise<{
  root: string;
  engine: GitEngine;
  statusChanges: () => number;
  filesChanges: () => VaultFilesChange[];
  notices: () => string[];
}> => {
  const root =
    args.root ??
    (args.seed === undefined
      ? scratchDir("inteligir-git-vault-")
      : path.join(scratchDir("inteligir-git-seeded-"), "vault"));
  const device = args.device ?? TEST_DEVICE;
  const bootstrap: EnsureVaultRepoArgs = { deviceName: device, git, root };
  if (args.seed !== undefined) {
    bootstrap.seed = args.seed;
  }
  await ensureVaultRepo(bootstrap);
  let statusChanges = 0;
  const filesChanges: VaultFilesChange[] = [];
  const notices: string[] = [];
  const engineArgs: GitEngineArgs = {
    deviceName: () => device,
    git: hermeticGit(args.env),
    onFilesChanged: (change) => {
      filesChanges.push(change);
    },
    onNotice: (message) => {
      notices.push(message);
    },
    onStatusChanged: () => {
      statusChanges += 1;
    },
    remote: () => (args.remoteUrl === null ? null : { source: "explicit", url: args.remoteUrl }),
    root,
    ...args.timing,
  };
  if (args.reconcile !== undefined) {
    engineArgs.reconcile = args.reconcile;
  }
  const engine = createGitEngine(engineArgs);
  onTestFinished(async () => {
    await engine.dispose();
  });
  return {
    engine,
    filesChanges: () => [...filesChanges],
    notices: () => [...notices],
    root,
    statusChanges: () => statusChanges,
  };
};

export const syncState = async (engine: GitEngine): Promise<VaultStatusResponse["state"]> => {
  const status = await engine.syncNow();
  return status.state;
};

export const commitCount = async (root: string): Promise<number> => {
  const { stdout } = await git.run(root, ["rev-list", "--count", "HEAD"]);
  return Math.trunc(Number(stdout.trim()));
};

export const lastMessage = async (root: string): Promise<string> => {
  const { stdout } = await git.run(root, ["log", "-1", "--format=%s"]);
  return stdout.trim();
};

// a person's own git in the vault, committing as the named device
export const asDevice = (device: string): RunGitOptions => ({ env: identityEnv(device) });

export const gitDirPath = async (root: string, rel: string): Promise<string> =>
  await gitPath(gitAt(git, root), root, rel);

export const expectCleanRepo = async (root: string): Promise<void> => {
  const { stdout } = await git.run(root, ["status", "--porcelain"]);
  expect(stdout).toBe("");
  expect(existsSync(await gitDirPath(root, "rebase-merge"))).toBe(false);
  expect(existsSync(await gitDirPath(root, "rebase-apply"))).toBe(false);
  await git.run(root, ["fsck", "--no-progress"]);
};

export const trackedFiles = async (root: string): Promise<string[]> => {
  const { stdout } = await git.run(root, ["ls-tree", "-r", "--name-only", "HEAD"]);
  return stdout.split("\n").filter((line) => line.length > 0);
};

export const seedMarker = async (root: string): Promise<string | null> => {
  try {
    const { stdout } = await git.run(root, ["config", "--get", SEED_COMMIT_KEY]);
    return stdout.trim();
  } catch {
    return null;
  }
};

export const refusingHook = async (hooksDir: string, name: string): Promise<void> => {
  await mkdir(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, name);
  await writeFile(hook, "#!/bin/sh\nexit 1\n", "utf-8");
  await chmod(hook, 0o755);
};

// a vault that is a linked worktree: its `.git` is a file, and its rebase state lives under the
// main checkout's git dir. main parks on another branch so the worktree can take `main`.
export const makeWorktreeVault = async (): Promise<string> => {
  const main = scratchDir("inteligir-git-main-");
  await initVault(main);
  await git.run(main, ["switch", "-q", "-c", "parked"]);
  const root = path.join(scratchDir("inteligir-git-worktree-"), "vault");
  await git.run(main, ["worktree", "add", "-q", root, "main"]);
  return root;
};
