import type { OriginConfig } from "../cloud/vault-remote";
import { REMOTE_MARKER_ACCOUNT, REMOTE_MARKER_KEY } from "./folder-facts";
import type { RunGitCommand } from "./git-run";

const ORIGIN_PUSH_URL_KEY = "remote.origin.pushurl";

export const currentBranch = async (run: RunGitCommand): Promise<string | null> => {
  try {
    const { stdout } = await run(["symbolic-ref", "--short", "-q", "HEAD"]);
    const branch = stdout.trim();
    // git refuses "-"-leading ref names itself; this only keeps a corrupted head out of argv.
    return branch.length > 0 && !branch.startsWith("-") ? branch : null;
  } catch {
    return null;
  }
};

export const readConfig = async (run: RunGitCommand, key: string): Promise<string | null> => {
  try {
    const { stdout } = await run(["config", "--get", key]);
    const value = stdout.trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
};

export const revParse = async (run: RunGitCommand, rev: string): Promise<string> => {
  const { stdout } = await run(["rev-parse", rev]);
  return stdout.trim();
};

export const revListCount = async (run: RunGitCommand, range: string): Promise<number> => {
  const { stdout } = await run(["rev-list", "--count", range]);
  return Math.trunc(Number(stdout.trim())) || 0;
};

// a failed check reads as "not an ancestor", which resends the push: the answer a doubt earns.
export const isAncestor = async (
  run: RunGitCommand,
  ancestor: string,
  rev: string,
): Promise<boolean> => {
  try {
    await run(["merge-base", "--is-ancestor", ancestor, rev]);
    return true;
  } catch {
    return false;
  }
};

// a new url leaves the old remote's tips under refs/remotes/origin, and a status measured against
// them would call the vault synced with a remote that never saw it.
const forgetOriginTips = async (run: RunGitCommand): Promise<void> => {
  const { stdout } = await run([
    "for-each-ref",
    "--format=delete %(refname)",
    "refs/remotes/origin",
  ]);
  if (stdout.trim().length > 0) {
    // origin/HEAD is a symref: deleted through, it would delete the branch it names twice.
    await run(["update-ref", "--no-deref", "--stdin"], { input: stdout });
  }
};

// the one way the app moves the origin, a pass's and a choice's alike: a hand-set pushurl
// outlives `set-url`, and pushes would keep going where the vault synced before.
export const pointOrigin = async (
  run: RunGitCommand,
  current: string | null,
  url: string,
): Promise<void> => {
  if (current === url) {
    return;
  }
  if (current !== null) {
    await forgetOriginTips(run);
  }
  if ((await readConfig(run, ORIGIN_PUSH_URL_KEY)) !== null) {
    await run(["config", "--unset-all", ORIGIN_PUSH_URL_KEY]);
  }
  // "--" so the url can never read as an option.
  await run(
    current === null
      ? ["remote", "add", "--", "origin", url]
      : ["remote", "set-url", "--", "origin", url],
  );
};

// the origin is the vault's own record of where it syncs, so the app marks the origin it manages
// and drops the mark when an explicit remote takes it over.
export const markOrigin = async (
  run: RunGitCommand,
  managed: boolean,
  origin: OriginConfig,
): Promise<void> => {
  if (managed && !origin.markedAccount) {
    await run(["config", REMOTE_MARKER_KEY, REMOTE_MARKER_ACCOUNT]);
  } else if (!managed && origin.markedAccount) {
    await run(["config", "--unset-all", REMOTE_MARKER_KEY]);
  }
};
