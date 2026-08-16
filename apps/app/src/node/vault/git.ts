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
export interface CommitAuthor {
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

/**
 * Strip userinfo before a remote URL reaches a log line or a status response:
 * an https remote is where a token rides (https://user:ghp_…@github.com/…).
 * Non-URL forms (scp-like git@host:path) pass through — that syntax has no
 * password slot.
 */
export function redactRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username === "" && parsed.password === "") {
      return url;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
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
  /** Commit whatever is dirty right now; null when the tree was clean.
   *  `subject` replaces the default one-line message (trailers ride in it). */
  commitNow(author?: CommitAuthor, subject?: string): Promise<{ files: number } | null>;
  /**
   * Commit exactly the named vault-relative paths (adds, edits AND deletions
   * under them) — the agent-attribution seam: a turn commits its own write
   * set, never the whole dirty tree, so a concurrent turn's held writes and a
   * user's unrelated edits stay uncommitted for their own settle/debounce.
   * Null when none of the paths are dirty. Runs under the repo lock; allowed
   * under a hold (it IS a hold's release path).
   */
  commitPaths(
    paths: readonly string[],
    author: CommitAuthor,
    subject: string,
  ): Promise<{ files: number } | null>;
  /**
   * Defer the auto-commit debounce and the sync loop until released, so an
   * agent turn's writes are not swept into an engine-attributed commit
   * mid-turn. Counted — overlapping turns each take their own hold — and an
   * explicit commitNow still runs under a hold (that IS the release path's
   * commit). Returns the release function.
   */
  holdCommits(): () => void;
  /** One full sync pass; coalesces with an in-flight one. */
  syncNow(): Promise<VaultStatusResponse>;
  status(): Promise<VaultStatusResponse>;
  /** True while a sync pass runs; the runtime suppresses watcher fan-out under it. */
  isSyncing(): boolean;
  /**
   * Serialize repo-touching work behind the same lock commits and syncs hold.
   * Vault mutations run through this so a write can never interleave a
   * rebase's checkout/abort window.
   */
  runExclusive<T>(work: () => Promise<T>): Promise<T>;
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
  /** Set when a failed rebase could not be aborted; syncs stop until repaired. */
  let broken = false;
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

  async function commitIfDirty(
    author?: CommitAuthor,
    subject?: string,
  ): Promise<{ files: number } | null> {
    const files = await countDirtyPaths();
    if (files === 0) {
      return null;
    }
    await run(["add", "-A"]);
    await run(
      ["-c", "commit.gpgsign=false", "commit", "-m", subject ?? `vault: update ${files} files`],
      {
        env: identityEnv(author),
      },
    );
    args.onStatusChanged?.();
    return { files };
  }

  /** The paths git itself reports dirty (staged or not) under the pathspecs.
   *  -z: NUL-separated and unquoted, so a path with spaces round-trips. */
  async function dirtyPathsUnder(paths: readonly string[]): Promise<string[]> {
    const { stdout } = await run([
      "--no-optional-locks",
      "status",
      "--porcelain",
      "-z",
      "--",
      ...paths,
    ]);
    const tokens = stdout.split("\0");
    const dirty: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === undefined || token.length < 4) {
        continue;
      }
      dirty.push(token.slice(3));
      // A rename/copy entry (an R or C in the two status columns) is followed
      // by its ORIGIN path as its own token; both sides belong to the commit.
      if (/[RC]/u.test(token.slice(0, 2))) {
        const origin = tokens[index + 1];
        if (origin !== undefined && origin.length > 0) {
          dirty.push(origin);
          index += 1;
        }
      }
    }
    return dirty;
  }

  async function commitPathsIfDirty(
    paths: readonly string[],
    author: CommitAuthor,
    subject: string,
  ): Promise<{ files: number } | null> {
    if (paths.length === 0) {
      return null;
    }
    // Restrict the pathspec to what is actually dirty: `git add` errors on a
    // pathspec matching nothing, and a reported write may have been reverted.
    const dirty = await dirtyPathsUnder(paths);
    if (dirty.length === 0) {
      return null;
    }
    // -A with a pathspec stages deletions under it too; the commit takes only
    // the index, so everything else dirty stays for its own commit.
    await run(["add", "-A", "--", ...dirty]);
    await run(["-c", "commit.gpgsign=false", "commit", "-m", subject], {
      env: identityEnv(author),
    });
    args.onStatusChanged?.();
    return { files: dirty.length };
  }

  // An agent turn holds commits so its writes cannot be swept into an
  // engine-attributed commit mid-turn; the flush the hold deflected is
  // re-armed on release (the release path's own commitNow usually beat it,
  // making the re-armed flush a clean-tree no-op).
  let commitHoldCount = 0;
  let flushDeferredWhileHeld = false;

  const commitScheduler = createDebouncedCallbackScheduler({
    debounceMs: args.quietMs ?? AUTO_COMMIT_QUIET_MS,
    maxWaitMs: args.maxWaitMs ?? AUTO_COMMIT_MAX_WAIT_MS,
    onFlush: () => {
      if (disposed) {
        return;
      }
      if (commitHoldCount > 0) {
        flushDeferredWhileHeld = true;
        return;
      }
      void withRepoLock(() => commitIfDirty()).catch((error: unknown) => {
        args.onError?.(error instanceof Error ? error.message : "auto-commit failed");
      });
    },
  });

  function holdCommits(): () => void {
    commitHoldCount += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      commitHoldCount -= 1;
      if (commitHoldCount === 0 && flushDeferredWhileHeld) {
        flushDeferredWhileHeld = false;
        commitScheduler.schedule();
      }
    };
  }

  async function currentBranch(): Promise<string | null> {
    try {
      const { stdout } = await run(["symbolic-ref", "--short", "-q", "HEAD"]);
      const branch = stdout.trim();
      // git itself refuses "-"-leading ref names, so this only guards a
      // corrupted HEAD from ever reaching an argv slot.
      return branch.length > 0 && !branch.startsWith("-") ? branch : null;
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
    // "--" terminates option parsing: the URL is config-validated, but a
    // positional that can never read as an option needs no trust in that.
    if (existing === null) {
      await run(["remote", "add", "--", "origin", url]);
    } else if (existing !== url) {
      await run(["remote", "set-url", "--", "origin", url]);
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

  /** The files git itself marks unmerged (UU/AA/DD/…): the honest conflict
   *  set, read from the halted rebase before it is aborted. */
  async function unmergedPaths(): Promise<string[]> {
    const { stdout } = await run(["--no-optional-locks", "status", "--porcelain"]);
    const files: string[] = [];
    for (const line of stdout.split("\n")) {
      if (line.length < 4) {
        continue;
      }
      const x = line[0];
      const y = line[1];
      const unmerged =
        x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
      if (unmerged) {
        files.push(line.slice(3));
      }
    }
    return files.toSorted();
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
        // Capture git's own unmerged set BEFORE the abort wipes it — that
        // list, not a branch-diff heuristic, is what a conflict IS.
        const conflictFiles = rebaseInProgress() ? await unmergedPaths().catch(() => []) : [];
        if (rebaseInProgress()) {
          // NEVER leave the repo mid-rebase: abort first, report after.
          await run(["rebase", "--abort"]).catch(() => {});
        }
        // A swallowed failed abort would leave every later commit landing in
        // rebase state; verify, and stop syncing if the repo is truly stuck.
        if (rebaseInProgress() || (await unmergedPaths().catch(() => ["unknown"])).length > 0) {
          broken = true;
          lastError =
            `a failed rebase could not be aborted; manual recovery needed: ` +
            `run \`git rebase --abort\` in ${root}, then restart inteligir`;
          return;
        }
        if (conflictFiles.length > 0) {
          const remoteRef = `refs/remotes/origin/${branch}`;
          lastConflict = {
            files: conflictFiles,
            ours: { commits: await revListCount(`${remoteRef}..HEAD`).catch(() => 0) },
            theirs: { commits: await revListCount(`HEAD..${remoteRef}`).catch(() => 0) },
          };
          return;
        }
        // The rebase failed for a non-conflict reason: an honest error, not a
        // conflict that names no files.
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
    // Status responses carry the redacted remote: an https remote is where a
    // token rides, and this string reaches logs and the UI.
    const remote = redactRemoteUrl(remoteUrl);
    if (syncing) {
      return { state: "syncing", remote, lastSyncAt, lastError };
    }
    if (broken) {
      return { state: "broken", remote, lastSyncAt, lastError };
    }
    if (lastConflict !== null) {
      return {
        state: "conflict",
        remote,
        conflict: lastConflict,
        lastSyncAt,
        lastError,
      };
    }
    // The porcelain reads run behind the repo lock, so a status can never
    // report the half-way tree of a sync or commit in flight.
    return withRepoLock(async () => {
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
        return { state: "dirty", remote, lastSyncAt, lastError };
      }
      return { state: "clean", remote, lastSyncAt, lastError };
    });
  }

  function syncNow(): Promise<VaultStatusResponse> {
    if (inflightSync !== null) {
      return inflightSync;
    }
    // A sync pass starts by committing the dirty tree, which is exactly what
    // a commit hold exists to prevent; the interval retries after release.
    if (remoteUrl === null || broken || commitHoldCount > 0) {
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
    commitNow(author?: CommitAuthor, subject?: string) {
      return withRepoLock(() => commitIfDirty(author, subject));
    },
    commitPaths(paths, author, subject) {
      return withRepoLock(() => commitPathsIfDirty(paths, author, subject));
    },
    holdCommits,
    syncNow,
    status: statusSnapshot,
    isSyncing: () => syncing,
    runExclusive: withRepoLock,
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
      // Flush, never cancel: dirt at shutdown is exactly what auto-commit
      // exists for, and the debounce it was waiting on dies with the process.
      await withRepoLock(() => commitIfDirty()).catch(() => undefined);
    },
  };
}
