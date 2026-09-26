// A Mac without Xcode or its command-line tools still has /usr/bin/git, but only as a stub that
// fails and offers to install them, so the vault could not even initialize and an agent's own
// `git status` would raise the offer mid-turn. The packaged app ships a git of its own for that
// Mac. A Mac that has the tools keeps its own git, and with it the Keychain helper a remote of the
// user's own signs in through, which the shipped git does not carry.

import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { mergePath } from "./login-shell-path";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;
// where electron-builder's extraResources puts scripts/fetch-git.mjs's payload
const BUNDLED_GIT_DIR_NAME = "git";

export type GitResolution = { source: "host" } | { source: "bundled"; root: string };

export interface ResolveGitArgs {
  // a dev launch runs the developer's own git, like its terminal does
  isPackaged: boolean;
  resourcesPath: string;
  // the active developer directory, or a rejection when none is selected
  printDeveloperDir: () => Promise<string>;
  isExecutableFile: (file: string) => boolean;
}

// a selection is not an install: Xcode deleted from under its selection leaves one naming nothing
export const resolveGit = async (args: ResolveGitArgs): Promise<GitResolution> => {
  if (!args.isPackaged) {
    return { source: "host" };
  }
  let developerDir = "";
  try {
    const printed = await args.printDeveloperDir();
    developerDir = printed.trim();
  } catch {
    // no selection: the tools were never installed
  }
  if (developerDir !== "" && args.isExecutableFile(path.join(developerDir, "usr", "bin", "git"))) {
    return { source: "host" };
  }
  return { root: path.join(args.resourcesPath, BUNDLED_GIT_DIR_NAME), source: "bundled" };
};

export interface BundledGitEnv {
  PATH: string;
  GIT_CONFIG_SYSTEM: string;
  GIT_EXEC_PATH: string;
  GIT_TEMPLATE_DIR: string;
}

// built for prefix=/ without RUNTIME_PREFIX, so it finds its helpers, its templates and its system
// config only where these name them. the config is a file, never GIT_CONFIG_COUNT rows: the hosted
// remote's bearer rides those per invocation (apps/cli/src/server/cloud/vault-remote.ts), and would
// replace any set here.
export const bundledGitEnv = (
  resolution: GitResolution,
  shellPath: string | undefined,
): BundledGitEnv | null => {
  if (resolution.source === "host") {
    return null;
  }
  const { root } = resolution;
  return {
    GIT_CONFIG_SYSTEM: path.join(root, "etc", "gitconfig"),
    GIT_EXEC_PATH: path.join(root, "libexec", "git-core"),
    GIT_TEMPLATE_DIR: path.join(root, "share", "git-core", "templates"),
    PATH: mergePath([path.join(root, "bin")], shellPath),
  };
};

// only reads the selection, so unlike the stub it never offers an install
export const printDeveloperDir = async (): Promise<string> => {
  const { stdout } = await execFileAsync("/usr/bin/xcode-select", ["-p"], {
    encoding: "utf-8",
    timeout: PROBE_TIMEOUT_MS,
  });
  return stdout;
};

export const isExecutableFile = (file: string): boolean => {
  try {
    if (!statSync(file).isFile()) {
      return false;
    }
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
