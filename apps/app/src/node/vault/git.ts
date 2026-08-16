// The vault's git engine, over the SYSTEM git binary (execFile, no shell).
// Owns repo init, the auto-commit debounce, and the sync loop
// (fetch → rebase → push against the configured remote). A refused rebase is
// always aborted — the repo is never left mid-rebase — and surfaces as a typed
// conflict state instead.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VaultConflict, VaultStatusResponse } from "@repo/server-contract/vault";
import { VAULT_TMP_PREFIX } from "./vault-paths";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";

const LOCAL_GIT_TIMEOUT_MS = 30_000;
const NETWORK_GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

const AUTO_COMMIT_QUIET_MS = 2_000;
const AUTO_COMMIT_MAX_WAIT_MS = 10_000;

/** Commits the engine makes on its own carry this identity; an agent-attributed
 *  commit (#549) overrides the AUTHOR half only, so the committer always says
 *  which machine wrote it. */
const ENGINE_IDENTITY = { name: "inteligir", email: "vault@inteligir.local" };

/** The author seam: agent-attributed commits (#549) pass their own identity. */
interface CommitAuthor {
  name: string;
  email: string;
}

class GitError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
  }
}

interface RunGitOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

export function runGit(
  cwd: string,
  gitArgs: readonly string[],
  options: RunGitOptions = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...gitArgs],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        timeout: options.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
        env: { ...process.env, ...options.env },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitError(`git ${gitArgs[0] ?? ""} failed: ${error.message}`, stderr));
          return;
        }
        resolve({ stdout });
      },
    );
  });
}

function identityEnv(author?: CommitAuthor): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: author?.name ?? ENGINE_IDENTITY.name,
    GIT_AUTHOR_EMAIL: author?.email ?? ENGINE_IDENTITY.email,
    GIT_COMMITTER_NAME: ENGINE_IDENTITY.name,
    GIT_COMMITTER_EMAIL: ENGINE_IDENTITY.email,
  };
}

async function ensureLocalExclude(root: string): Promise<void> {
  // .git/info/exclude, not a .gitignore: the staging pattern is machinery,
  // and the vault's files belong to the user.
  const excludePath = join(root, ".git", "info", "exclude");
  const pattern = `${VAULT_TMP_PREFIX}*`;
  const existing = await readFile(excludePath, "utf8").catch(() => "");
  if (existing.split("\n").includes(pattern)) {
    return;
  }
  await appendFile(excludePath, `${pattern}\n`, "utf8");
}

async function hasHeadCommit(root: string, env?: Record<string, string>): Promise<boolean> {
  try {
    await runGit(root, ["rev-parse", "--verify", "-q", "HEAD"], env ? { env } : {});
    return true;
  } catch {
    return false;
  }
}

export interface EnsureVaultRepoArgs {
  root: string;
  /** Runs when the directory did not exist before this boot (the welcome seed). */
  seed?: (root: string) => Promise<void>;
  env?: Record<string, string>;
}

/**
 * Create + `git init` the vault directory if absent, and always leave it with
 * a born HEAD — the sync loop rebases, and a rebase needs a commit to stand on.
 */
export async function ensureVaultRepo(args: EnsureVaultRepoArgs): Promise<{ created: boolean }> {
  const created = !existsSync(args.root);
  await mkdir(args.root, { recursive: true });
  const runOptions = args.env ? { env: args.env } : {};
  if (!existsSync(join(args.root, ".git"))) {
    await runGit(args.root, ["init", "-b", "main"], runOptions);
  }
  await ensureLocalExclude(args.root);
  if (created && args.seed) {
    await args.seed(args.root);
  }
  if (!(await hasHeadCommit(args.root, args.env))) {
    await runGit(args.root, ["add", "-A"], runOptions);
    await runGit(
      args.root,
      ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "vault: initialize"],
      { env: { ...args.env, ...identityEnv() } },
    );
  }
  return { created };
}

export interface GitEngineArgs {
  root: string;
  /** null = local-only: commits still happen, the sync loop stays idle. */
  remoteUrl: string | null;
  /** Fired on every sync-status transition (sync start/end, commit landed). */
  onStatusChanged?: () => void;
  /** Fired when a sync moved the working tree (a rebase applied remote work). */
  onFilesChanged?: () => void;
  onError?: (message: string) => void;
  quietMs?: number;
  maxWaitMs?: number;
  /** Extra env for every git invocation (tests: hermetic HOME/config). */
  env?: Record<string, string>;
}

export interface GitEngine {
  /** Debounced: a burst of writes lands as ONE commit after the quiet window. */
  scheduleCommit(): void;
  /** Commit whatever is dirty right now; null when the tree was clean. */
  commitNow(author?: CommitAuthor): Promise<{ files: number } | null>;
  /** One full sync pass; coalesces with an in-flight one. */
  syncNow(): Promise<VaultStatusResponse>;
  status(): Promise<VaultStatusResponse>;
  startAutoSync(intervalMs: number): void;
  dispose(): Promise<void>;
}

export function createGitEngine(args: GitEngineArgs): GitEngine {
  const root = args.root;
  const remoteUrl = args.remoteUrl;
  const extraEnv = args.env ?? {};

  let lastSyncAt: number | null = null;
  let lastError: string | null = null;
  let lastConflict: VaultConflict | null = null;
  let syncing = false;
  let disposed = false;
  let inflightSync: Promise<VaultStatusResponse> | null = null;
  let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

  // Commits and syncs both mutate the repo; one at a time, in arrival order.
  let repoChain: Promise<unknown> = Promise.resolve();
  function withRepoLock<T>(work: () => Promise<T>): Promise<T> {
    const next = repoChain.then(work, work);
    repoChain = next.catch(() => undefined);
    return next;
  }

  function run(gitArgs: readonly string[], options: RunGitOptions = {}) {
    return runGit(root, gitArgs, { ...options, env: { ...extraEnv, ...options.env } });
  }

  async function countDirtyPaths(): Promise<number> {
    const { stdout } = await run(["--no-optional-locks", "status", "--porcelain"]);
    return stdout.split("\n").filter((line) => line.length > 0).length;
  }

  async function commitIfDirty(author?: CommitAuthor): Promise<{ files: number } | null> {
    const files = await countDirtyPaths();
    if (files === 0) {
      return null;
    }
    await run(["add", "-A"]);
    await run(["-c", "commit.gpgsign=false", "commit", "-m", `vault: update ${files} files`], {
      env: identityEnv(author),
    });
    args.onStatusChanged?.();
    return { files };
  }

  const commitScheduler = createDebouncedCallbackScheduler({
    debounceMs: args.quietMs ?? AUTO_COMMIT_QUIET_MS,
    maxWaitMs: args.maxWaitMs ?? AUTO_COMMIT_MAX_WAIT_MS,
    onFlush: () => {
      if (disposed) {
        return;
      }
      void withRepoLock(() => commitIfDirty()).catch((error: unknown) => {
        args.onError?.(error instanceof Error ? error.message : "auto-commit failed");
      });
    },
  });

  async function currentBranch(): Promise<string | null> {
    try {
      const { stdout } = await run(["symbolic-ref", "--short", "-q", "HEAD"]);
      const branch = stdout.trim();
      return branch.length > 0 ? branch : null;
    } catch {
      return null;
    }
  }

  async function ensureOriginRemote(url: string): Promise<void> {
    let existing: string | null;
    try {
      const { stdout } = await run(["remote", "get-url", "origin"]);
      existing = stdout.trim();
    } catch {
      existing = null;
    }
    if (existing === null) {
      await run(["remote", "add", "origin", url]);
    } else if (existing !== url) {
      await run(["remote", "set-url", "origin", url]);
    }
  }

  function rebaseInProgress(): boolean {
    return (
      existsSync(join(root, ".git", "rebase-merge")) ||
      existsSync(join(root, ".git", "rebase-apply"))
    );
  }

  async function revListCount(range: string): Promise<number> {
    const { stdout } = await run(["rev-list", "--count", range]);
    return Number.parseInt(stdout.trim(), 10) || 0;
  }

  async function changedSince(base: string, tip: string): Promise<Set<string>> {
    const { stdout } = await run(["diff", "--name-only", base, tip]);
    return new Set(stdout.split("\n").filter((line) => line.length > 0));
  }

  async function computeConflict(branch: string): Promise<VaultConflict | null> {
    const remoteRef = `refs/remotes/origin/${branch}`;
    const oursCommits = await revListCount(`${remoteRef}..HEAD`);
    const theirsCommits = await revListCount(`HEAD..${remoteRef}`);
    if (oursCommits === 0 && theirsCommits === 0) {
      return null;
    }
    const { stdout } = await run(["merge-base", "HEAD", remoteRef]);
    const mergeBase = stdout.trim();
    const ours = await changedSince(mergeBase, "HEAD");
    const theirs = await changedSince(mergeBase, remoteRef);
    const files = [...ours].filter((file) => theirs.has(file)).toSorted();
    return {
      files,
      ours: { commits: oursCommits },
      theirs: { commits: theirsCommits },
    };
  }

  function isMissingRemoteRef(error: unknown): boolean {
    return error instanceof GitError && /couldn't find remote ref/i.test(error.stderr);
  }

  async function doSync(): Promise<void> {
    if (remoteUrl === null) {
      return;
    }
    await commitIfDirty();
    await ensureOriginRemote(remoteUrl);
    const branch = await currentBranch();
    if (branch === null) {
      lastError = "vault HEAD is detached; sync needs a branch";
      return;
    }

    let remoteHasBranch = true;
    try {
      await run(["fetch", "origin", branch], { timeoutMs: NETWORK_GIT_TIMEOUT_MS });
    } catch (error) {
      if (!isMissingRemoteRef(error)) {
        throw error;
      }
      // A fresh remote: nothing to rebase onto, the push below creates it.
      remoteHasBranch = false;
    }

    if (remoteHasBranch) {
      const headBefore = (await run(["rev-parse", "HEAD"])).stdout.trim();
      try {
        // --empty=drop: a local commit whose changes already landed upstream
        // adds nothing — without the flag the merge backend can halt on it,
        // which would read as a conflict that names no files.
        await run([
          "-c",
          "commit.gpgsign=false",
          "rebase",
          "--empty=drop",
          `refs/remotes/origin/${branch}`,
        ]);
      } catch (error) {
        if (rebaseInProgress()) {
          // NEVER leave the repo mid-rebase: abort first, report after.
          await run(["rebase", "--abort"]).catch(() => {});
        }
        const conflict = await computeConflict(branch).catch(() => null);
        if (conflict !== null) {
          lastConflict = conflict;
          return;
        }
        throw error;
      }
      lastConflict = null;
      const headAfter = (await run(["rev-parse", "HEAD"])).stdout.trim();
      if (headAfter !== headBefore) {
        args.onFilesChanged?.();
      }
    }

    await run(["push", "origin", branch], { timeoutMs: NETWORK_GIT_TIMEOUT_MS });
    lastConflict = null;
    lastSyncAt = Date.now();
    lastError = null;
  }

  async function statusSnapshot(): Promise<VaultStatusResponse> {
    if (remoteUrl === null) {
      return { state: "no-remote", lastSyncAt, lastError };
    }
    if (syncing) {
      return { state: "syncing", remote: remoteUrl, lastSyncAt, lastError };
    }
    if (lastConflict !== null) {
      return {
        state: "conflict",
        remote: remoteUrl,
        conflict: lastConflict,
        lastSyncAt,
        lastError,
      };
    }
    const dirtyPaths = await countDirtyPaths().catch(() => 0);
    let unpushed = 0;
    if (dirtyPaths === 0) {
      const branch = await currentBranch();
      if (branch !== null) {
        // No remote-tracking ref yet means everything local is unpushed.
        unpushed = await revListCount(`refs/remotes/origin/${branch}..HEAD`).catch(() => 1);
      }
    }
    if (dirtyPaths > 0 || unpushed > 0) {
      return { state: "dirty", remote: remoteUrl, lastSyncAt, lastError };
    }
    return { state: "clean", remote: remoteUrl, lastSyncAt, lastError };
  }

  function syncNow(): Promise<VaultStatusResponse> {
    if (inflightSync !== null) {
      return inflightSync;
    }
    if (remoteUrl === null) {
      return statusSnapshot();
    }
    syncing = true;
    args.onStatusChanged?.();
    const pass = withRepoLock(doSync)
      .catch((error: unknown) => {
        lastError = error instanceof Error ? error.message : "sync failed";
        args.onError?.(lastError);
      })
      .then(() => {
        syncing = false;
        args.onStatusChanged?.();
        return statusSnapshot();
      })
      .finally(() => {
        inflightSync = null;
      });
    inflightSync = pass;
    return pass;
  }

  return {
    scheduleCommit() {
      if (!disposed) {
        commitScheduler.schedule();
      }
    },
    commitNow(author?: CommitAuthor) {
      return withRepoLock(() => commitIfDirty(author));
    },
    syncNow,
    status: statusSnapshot,
    startAutoSync(intervalMs: number) {
      if (disposed || remoteUrl === null || autoSyncTimer !== null) {
        return;
      }
      autoSyncTimer = setInterval(() => {
        void syncNow();
      }, intervalMs);
      autoSyncTimer.unref?.();
    },
    async dispose() {
      disposed = true;
      commitScheduler.dispose();
      if (autoSyncTimer !== null) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
      }
      await repoChain.catch(() => undefined);
    },
  };
}
