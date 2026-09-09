import { existsSync } from "node:fs";
import path from "node:path";
import type {
  VaultConflict,
  VaultDeletedEntry,
  VaultRevision,
  VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import type { VaultRemoteProvider, VaultRemoteSpec } from "../cloud/vault-remote";
import { ACCOUNT_MARKER_KEY } from "./git-bootstrap";
import { readDeletedNotes, readNoteHistory, readNoteRevision } from "./git-history";
import type { NoteHistoryPage } from "./git-history";
import { entryPaths, isUnmerged, readPorcelain } from "./git-porcelain";
import type { PorcelainEntry } from "./git-porcelain";
import {
  identityEnv,
  isAuthRefusal,
  isMissingRemoteRef,
  NETWORK_GIT_TIMEOUT_MS,
  redactRemoteUrl,
  runGit,
} from "./git-run";
import type { CommitAuthor, RunGitOptions } from "./git-run";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";

// a 15s pause ends an editing session, so the log stays answerable ("the version from before
// i rewrote the intro") rather than thirty anonymous revisions; the max wait is the sync
// interval, since a sync pass commits the dirty tree before it pushes.
const AUTO_COMMIT_QUIET_MS = 15_000;
const AUTO_COMMIT_MAX_WAIT_MS = 60_000;

// past this a scoped commit costs more argv (status pathspec, then add) than the unscoped sweep.
const MAX_SCOPED_COMMIT_PATHS = 200;

const autoCommitSubject = (paths: readonly string[]): string => {
  const only = paths.length === 1 ? paths[0] : undefined;
  return only === undefined
    ? `vault: update ${String(paths.length)} files`
    : `vault: update ${only}`;
};

export interface GitEngineArgs {
  root: string;
  // re-read every pass so a sign-in or sign-out flips sync live without a restart.
  remote: VaultRemoteProvider;
  // fired on a sync transition, never on a commit: the state is dirty on both sides of a
  // commit, and each announcement costs every client a porcelain read under the repo lock.
  onStatusChanged?: () => void;
  onFilesChanged?: () => void;
  onError?: (message: string) => void;
  quietMs?: number;
  maxWaitMs?: number;
  env?: Record<string, string>;
}

export interface GitEngine {
  // the flush stages the window's union of paths; no paths means "whatever is dirty" and makes
  // the whole window's flush unscoped. a change nobody announced waits for a whole-tree caller
  // (a sync pass, commitNow, shutdown, the next boot).
  scheduleCommit: (paths?: readonly string[]) => void;
  commitNow: () => Promise<{ files: number } | null>;
  // stages adds, edits and deletions under the paths, never the whole dirty tree; allowed
  // under a hold, being the hold's release path.
  commitPaths: (
    paths: readonly string[],
    author: CommitAuthor,
    subject: string,
  ) => Promise<{ files: number } | null>;
  // counted: overlapping turns each take their own hold. returns the release.
  holdCommits: () => () => void;
  // off the repo lock: log and cat-file never touch the index, and the lock is the chain a
  // whole sync pass holds, network timeouts included. a read inside a rebase sees its
  // temporary head.
  history: (path: string, page: NoteHistoryPage) => Promise<VaultRevision[]>;
  revision: (path: string, sha: string) => Promise<string>;
  deleted: () => Promise<VaultDeletedEntry[]>;
  syncNow: () => Promise<VaultStatusResponse>;
  status: () => Promise<VaultStatusResponse>;
  isSyncing: () => boolean;
  // vault mutations run through this so a write cannot interleave a rebase's checkout/abort window.
  runExclusive: <T>(work: () => Promise<T>) => Promise<T>;
  startAutoSync: (intervalMs: number) => void;
  dispose: () => Promise<void>;
}

export const createGitEngine = (args: GitEngineArgs): GitEngine => {
  const { root } = args;
  const extraEnv = args.env ?? {};

  let lastSyncAt: number | null = null;
  let lastError: string | null = null;
  let lastConflict: VaultConflict | null = null;
  let broken = false;
  // one value, not two booleans: "offline" heals on its own while "unauthorized" refuses every
  // retry until the user signs in again, and the latest outcome wins. it outranks the porcelain read because
  // a failed fetch leaves the tracking ref stale, so "unpushed" would read clean.
  let networkFailure: "offline" | "unauthorized" | null = null;
  // while true no network invocation runs: pushing would upload this vault into an account
  // that never held it.
  let accountMismatch = false;
  let syncing = false;
  let disposed = false;
  let inflightSync: Promise<VaultStatusResponse> | null = null;
  let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

  let repoChain: Promise<unknown> = Promise.resolve();
  const withRepoLock = async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = repoChain;
    const next = (async () => {
      await previous;
      return await work();
    })();
    repoChain = (async () => {
      try {
        await next;
      } catch {
        // the rejection is the caller's; the chain only orders the next turn.
      }
    })();
    return await next;
  };

  const run = async (gitArgs: readonly string[], options: RunGitOptions = {}) =>
    await runGit(root, gitArgs, { ...options, env: { ...extraEnv, ...options.env } });

  const runNetwork = async (gitArgs: readonly string[], env?: Record<string, string>) => {
    try {
      const options: RunGitOptions = { timeoutMs: NETWORK_GIT_TIMEOUT_MS };
      if (env) {
        options.env = env;
      }
      return await run(gitArgs, options);
    } catch (error) {
      networkFailure = isAuthRefusal(error) ? "unauthorized" : "offline";
      throw error;
    }
  };

  const porcelain = async (paths: readonly string[] = []): Promise<PorcelainEntry[]> =>
    await readPorcelain(run, paths);

  const commitIfDirty = async (): Promise<{ files: number } | null> => {
    const dirty = entryPaths(await porcelain());
    if (dirty.length === 0) {
      return null;
    }
    // unscoped: the scoped form passes every path as argv, and a large vault's first commit
    // would exceed ARG_MAX.
    await run(["add", "-A"]);
    await run(["-c", "commit.gpgsign=false", "commit", "-m", autoCommitSubject(dirty)], {
      env: identityEnv(),
    });
    return { files: dirty.length };
  };

  const commitPathsIfDirty = async (
    paths: readonly string[],
    author: CommitAuthor | undefined,
    subject: string | ((dirty: readonly string[]) => string),
  ): Promise<{ files: number } | null> => {
    if (paths.length === 0) {
      return null;
    }
    // git add errors on a pathspec matching nothing, and a reported write may have been reverted.
    const dirty = entryPaths(await porcelain(paths));
    if (dirty.length === 0) {
      return null;
    }
    // -A with a pathspec stages deletions under it too; the commit takes only the index.
    await run(["add", "-A", "--", ...dirty]);
    await run(
      [
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        subject instanceof Function ? subject(dirty) : subject,
      ],
      { env: identityEnv(author) },
    );
    return { files: dirty.length };
  };

  // a held flush is re-armed on release; the release path's own commitPaths usually beats it.
  let commitHoldCount = 0;
  let flushDeferredWhileHeld = false;

  // null means "whatever is dirty"; one unscoped call in the window decides the whole flush.
  let pendingCommitPaths: Set<string> | null = new Set();

  const noteCommitPaths = (paths: readonly string[] | undefined): void => {
    if (paths === undefined || pendingCommitPaths === null) {
      pendingCommitPaths = null;
      return;
    }
    for (const notePath of paths) {
      pendingCommitPaths.add(notePath);
    }
    if (pendingCommitPaths.size > MAX_SCOPED_COMMIT_PATHS) {
      pendingCommitPaths = null;
    }
  };

  const flushCommit = async (scoped: Set<string> | null): Promise<void> => {
    try {
      await withRepoLock(async () =>
        scoped === null
          ? await commitIfDirty()
          : await commitPathsIfDirty([...scoped], undefined, autoCommitSubject),
      );
    } catch (error) {
      // whatever failed is still dirty and its paths are spent: the next flush sweeps everything.
      pendingCommitPaths = null;
      args.onError?.(error instanceof Error ? error.message : "auto-commit failed");
    }
  };

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
      const scoped = pendingCommitPaths;
      pendingCommitPaths = new Set();
      void flushCommit(scoped);
    },
  });

  const holdCommits = (): (() => void) => {
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
  };

  const currentBranch = async (): Promise<string | null> => {
    try {
      const { stdout } = await run(["symbolic-ref", "--short", "-q", "HEAD"]);
      const branch = stdout.trim();
      // git refuses "-"-leading ref names itself; this only keeps a corrupted head out of argv.
      return branch.length > 0 && !branch.startsWith("-") ? branch : null;
    } catch {
      return null;
    }
  };

  const ensureOriginRemote = async (url: string): Promise<void> => {
    let existing: string | null;
    try {
      const { stdout } = await run(["remote", "get-url", "origin"]);
      existing = stdout.trim();
    } catch {
      existing = null;
    }
    // "--" so the url can never read as an option.
    if (existing === null) {
      await run(["remote", "add", "--", "origin", url]);
    } else if (existing !== url) {
      await run(["remote", "set-url", "--", "origin", url]);
    }
  };

  const rebaseInProgress = (): boolean =>
    existsSync(path.join(root, ".git", "rebase-merge")) ||
    existsSync(path.join(root, ".git", "rebase-apply"));

  const revListCount = async (range: string): Promise<number> => {
    const { stdout } = await run(["rev-list", "--count", range]);
    return Math.trunc(Number(stdout.trim())) || 0;
  };

  const unmergedPaths = async (): Promise<string[]> => {
    const entries = await porcelain();
    return entries
      .filter(isUnmerged)
      .map((entry) => entry.path)
      .toSorted();
  };

  const unmergedPathsOr = async (fallback: string[]): Promise<string[]> => {
    try {
      return await unmergedPaths();
    } catch {
      return fallback;
    }
  };

  const readAccountMarker = async (): Promise<string | null> => {
    try {
      const { stdout } = await run(["config", "--get", ACCOUNT_MARKER_KEY]);
      const value = stdout.trim();
      return value === "" ? null : value;
    } catch {
      return null;
    }
  };

  // the repo is left off its rebase either way; "unhandled" is the caller's cue to rethrow.
  const recoverFailedRebase = async (branch: string): Promise<"recorded" | "unhandled"> => {
    // git's own unmerged set, read before the abort wipes it.
    const conflictFiles = rebaseInProgress() ? await unmergedPathsOr([]) : [];
    if (rebaseInProgress()) {
      // never leave the repo mid-rebase.
      await run(["rebase", "--abort"]).catch(() => {
        /* empty */
      });
    }
    // a swallowed failed abort would leave every later commit landing in rebase state.
    const stillUnmerged = await unmergedPathsOr(["unknown"]);
    if (rebaseInProgress() || stillUnmerged.length > 0) {
      broken = true;
      lastError =
        `a failed rebase could not be aborted; manual recovery needed: ` +
        `run \`git rebase --abort\` in ${root}, then restart inteligir`;
      return "recorded";
    }
    if (conflictFiles.length > 0) {
      const remoteRef = `refs/remotes/origin/${branch}`;
      lastConflict = {
        files: conflictFiles,
        ours: { commits: await revListCount(`${remoteRef}..HEAD`).catch(() => 0) },
        theirs: { commits: await revListCount(`HEAD..${remoteRef}`).catch(() => 0) },
      };
      return "recorded";
    }
    return "unhandled";
  };

  const doSync = async (remote: VaultRemoteSpec): Promise<void> => {
    if (remote.source === "account" && remote.account === undefined) {
      // fail closed: the account id is not known yet (the /v1/account fetch is in flight), and
      // a pass now would skip the marker check, the window a new sign-in pushes the old vault
      // through. the thread sync retries that fetch and pings this engine when it lands.
      return;
    }
    if (remote.source === "account" && remote.account !== undefined) {
      const marker = await readAccountMarker();
      if (marker !== null && marker !== remote.account) {
        accountMismatch = true;
        // a conflict from the previous account describes a repo this pass will not touch, and
        // statusSnapshot ranks conflict above mismatch.
        lastConflict = null;
        lastError =
          "This vault last synced with a different account. Sign out, or move this vault aside " +
          "and restart to pull the new account's vault.";
        return;
      }
    }
    accountMismatch = false;
    await commitIfDirty();
    await ensureOriginRemote(remote.url);
    const branch = await currentBranch();
    if (branch === null) {
      lastError = "vault HEAD is detached; sync needs a branch";
      return;
    }

    let remoteHasBranch = true;
    try {
      await runNetwork(["fetch", "origin", branch], remote.env);
    } catch (error) {
      if (!isMissingRemoteRef(error)) {
        throw error;
      }
      // a fresh remote: the push below creates the branch. it answered, so it is not offline.
      networkFailure = null;
      remoteHasBranch = false;
    }

    if (remoteHasBranch) {
      const { stdout: headBefore } = await run(["rev-parse", "HEAD"]);
      try {
        // --empty=drop: a local commit already landed upstream would otherwise halt the merge
        // backend as a conflict naming no files.
        await run([
          "-c",
          "commit.gpgsign=false",
          "rebase",
          "--empty=drop",
          `refs/remotes/origin/${branch}`,
        ]);
      } catch (error) {
        if ((await recoverFailedRebase(branch)) === "unhandled") {
          throw error;
        }
        return;
      }
      lastConflict = null;
      const { stdout: headAfter } = await run(["rev-parse", "HEAD"]);
      if (headAfter.trim() !== headBefore.trim()) {
        args.onFilesChanged?.();
      }
    }

    await runNetwork(["push", "origin", branch], remote.env);
    if (remote.source === "account" && remote.account !== undefined) {
      const marker = await readAccountMarker();
      if (marker === null) {
        await run(["config", ACCOUNT_MARKER_KEY, remote.account]);
      }
    }
    lastConflict = null;
    lastSyncAt = Date.now();
    lastError = null;
    networkFailure = null;
  };

  const statusSnapshot = async (): Promise<VaultStatusResponse> => {
    const currentRemote = args.remote();
    if (currentRemote === null) {
      return { lastError, lastSyncAt, state: "no-remote" };
    }
    // redacted: an https remote carries the token, and this string reaches logs and the ui.
    const remote = redactRemoteUrl(currentRemote.url);
    const remoteSource = currentRemote.source;
    if (syncing) {
      return { lastError, lastSyncAt, remote, remoteSource, state: "syncing" };
    }
    if (broken) {
      return { lastError, lastSyncAt, remote, remoteSource, state: "broken" };
    }
    if (lastConflict !== null) {
      return {
        conflict: lastConflict,
        lastError,
        lastSyncAt,
        remote,
        remoteSource,
        state: "conflict",
      };
    }
    // these outrank the porcelain read: under a hold or after a failed fetch, clean/dirty
    // would be a claim about the remote this engine cannot make.
    if (commitHoldCount > 0) {
      return { lastError, lastSyncAt, remote, remoteSource, state: "held" };
    }
    if (accountMismatch) {
      return { lastError, lastSyncAt, remote, remoteSource, state: "account-mismatch" };
    }
    if (networkFailure !== null) {
      return { lastError, lastSyncAt, remote, remoteSource, state: networkFailure };
    }
    // behind the repo lock so a status never reports a sync's half-way tree.
    return await withRepoLock(async () => {
      const dirtyPaths = await porcelain()
        .then((entries) => entries.length)
        .catch(() => 0);
      let unpushed = 0;
      if (dirtyPaths === 0) {
        const branch = await currentBranch();
        if (branch !== null) {
          // no remote-tracking ref yet means everything local is unpushed.
          unpushed = await revListCount(`refs/remotes/origin/${branch}..HEAD`).catch(() => 1);
        }
      }
      if (dirtyPaths > 0 || unpushed > 0) {
        return { lastError, lastSyncAt, remote, remoteSource, state: "dirty" };
      }
      return { lastError, lastSyncAt, remote, remoteSource, state: "clean" };
    });
  };

  const runSyncPass = async (remote: VaultRemoteSpec): Promise<void> => {
    try {
      await withRepoLock(async () => {
        await doSync(remote);
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "sync failed";
      args.onError?.(lastError);
    }
  };

  const syncNow = async (): Promise<VaultStatusResponse> => {
    if (inflightSync !== null) {
      return await inflightSync;
    }
    // a pass starts by committing the dirty tree, which a hold exists to prevent; the snapshot
    // says "held" rather than reporting clean as if a pass ran. the provider is read once so
    // the gate and the pass agree on the remote.
    const remote = args.remote();
    if (remote === null || broken || commitHoldCount > 0) {
      return await statusSnapshot();
    }
    syncing = true;
    args.onStatusChanged?.();
    const pass = (async () => {
      try {
        await runSyncPass(remote);
        syncing = false;
        args.onStatusChanged?.();
        return await statusSnapshot();
      } finally {
        inflightSync = null;
      }
    })();
    inflightSync = pass;
    return await pass;
  };

  return {
    async commitNow() {
      return await withRepoLock(async () => await commitIfDirty());
    },
    async commitPaths(paths, author, subject) {
      return await withRepoLock(async () => await commitPathsIfDirty(paths, author, subject));
    },
    async deleted() {
      return await readDeletedNotes(run, (notePath) => existsSync(path.join(root, notePath)));
    },
    async dispose() {
      disposed = true;
      commitScheduler.dispose();
      if (autoSyncTimer !== null) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
      }
      // flush, never cancel: the debounce dies with the process. a failed flush rejects so the
      // shutdown exit code can name it.
      await withRepoLock(async () => await commitIfDirty());
    },
    async history(notePath, page) {
      return await readNoteHistory(run, notePath, page);
    },
    holdCommits,
    isSyncing: () => syncing,
    async revision(notePath, sha) {
      return await readNoteRevision(run, notePath, sha);
    },
    runExclusive: withRepoLock,
    scheduleCommit(paths?: readonly string[]) {
      if (!disposed) {
        noteCommitPaths(paths);
        commitScheduler.schedule();
      }
    },
    startAutoSync(intervalMs: number) {
      // armed with no remote too: a sign-in after boot starts syncing on the next tick.
      if (disposed || autoSyncTimer !== null) {
        return;
      }
      autoSyncTimer = setInterval(() => {
        void syncNow();
      }, intervalMs);
      autoSyncTimer.unref?.();
    },
    status: statusSnapshot,
    syncNow,
  };
};
