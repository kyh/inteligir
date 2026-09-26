// A Mac without Xcode or its command-line tools still has /usr/bin/git, but only as a stub that
// fails and offers to install them, so the vault could not even initialize and an agent's own
// `git status` would raise the offer mid-turn. The packaged app ships a git of its own for that
// Mac. A Mac that has the tools keeps its own git, and with it the Keychain helper a remote of the
// user's own signs in through, which the shipped git does not carry, unless the git a PATH lookup
// finds there is too old to push a vault.

import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { mergePath } from "./login-shell-path";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;
// where electron-builder's extraResources puts scripts/fetch-git.mjs's payload
const BUNDLED_GIT_DIR_NAME = "git";

// git 2.45 stopped setting its own Transfer-Encoding header on a streamed POST, which libcurl 8.7.0
// and 8.7.1 mishandle: an older git over either sends a push past 1 MiB as its first 4 bytes, and
// the remote refuses it. Homebrew's 2.39.0 over macOS's own libcurl does exactly that.
const MIN_HOST_GIT = { major: 2, minor: 45 };

export type BundledGitReason =
  | { kind: "no-developer-tools" }
  | { kind: "host-git-too-old"; version: string }
  // it would not even say its version, so the server could not run it either
  | { kind: "host-git-failed" };

export type GitResolution =
  | { source: "host" }
  | { source: "bundled"; root: string; why: BundledGitReason };

export interface ResolveGitArgs {
  // a dev launch runs the developer's own git, like its terminal does
  isPackaged: boolean;
  resourcesPath: string;
  // the active developer directory, or a rejection when none is selected
  printDeveloperDir: () => Promise<string>;
  isExecutableFile: (file: string) => boolean;
  // what the git a PATH lookup finds prints for `--version`, asked once PATH is the login shell's
  printHostGitVersion: () => Promise<string>;
}

// "git version 2.39.0", or Apple's "git version 2.39.5 (Apple Git-154)"; null for anything else
export const parseGitVersion = (printed: string): { major: number; minor: number } | null => {
  const match = /^git version (?<major>\d+)\.(?<minor>\d+)/u.exec(printed.trim());
  const { major, minor } = match?.groups ?? {};
  return major === undefined || minor === undefined
    ? null
    : { major: Number(major), minor: Number(minor) };
};

export const bundledGitReasonText = (why: BundledGitReason): string => {
  switch (why.kind) {
    case "no-developer-tools": {
      return "no developer tools on this Mac";
    }
    case "host-git-too-old": {
      return `this Mac's git ${why.version} is older than ${String(MIN_HOST_GIT.major)}.${String(MIN_HOST_GIT.minor)}`;
    }
    case "host-git-failed": {
      return "this Mac's git did not say its version";
    }
    // no default
  }
};

const olderThanKnownGood = ({ major, minor }: { major: number; minor: number }): boolean =>
  major < MIN_HOST_GIT.major || (major === MIN_HOST_GIT.major && minor < MIN_HOST_GIT.minor);

// a selection is not an install: Xcode deleted from under its selection leaves one naming nothing.
// a version this cannot read is left to run: only a known-bad one is traded for the Keychain helper
export const resolveGit = async (args: ResolveGitArgs): Promise<GitResolution> => {
  if (!args.isPackaged) {
    return { source: "host" };
  }
  const bundled = (why: BundledGitReason): GitResolution => ({
    root: path.join(args.resourcesPath, BUNDLED_GIT_DIR_NAME),
    source: "bundled",
    why,
  });
  let developerDir = "";
  try {
    const printed = await args.printDeveloperDir();
    developerDir = printed.trim();
  } catch {
    // no selection: the tools were never installed
  }
  if (developerDir === "" || !args.isExecutableFile(path.join(developerDir, "usr", "bin", "git"))) {
    return bundled({ kind: "no-developer-tools" });
  }
  let printed: string;
  try {
    printed = await args.printHostGitVersion();
  } catch {
    return bundled({ kind: "host-git-failed" });
  }
  const version = parseGitVersion(printed);
  return version !== null && olderThanKnownGood(version)
    ? bundled({
        kind: "host-git-too-old",
        version: `${String(version.major)}.${String(version.minor)}`,
      })
    : { source: "host" };
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

// a lookup by name, as the server's own runs are
export const printHostGitVersion = async (): Promise<string> => {
  const { stdout } = await execFileAsync("git", ["--version"], {
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
