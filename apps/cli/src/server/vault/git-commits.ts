import { vaultCommitSubject } from "@repo/contract/cloud/vault/vault-git";
import { entryPaths, readPorcelain } from "./git-porcelain";
import { identityEnv } from "./git-run";
import type { CommitAuthor, RunGitCommand } from "./git-run";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";

// a 15s pause ends an editing session, so the log stays answerable ("the version from before
// i rewrote the intro") rather than thirty anonymous revisions; the max wait is the sync
// interval, since a sync pass commits the dirty tree before it pushes.
const AUTO_COMMIT_QUIET_MS = 15_000;
const AUTO_COMMIT_MAX_WAIT_MS = 60_000;

// past this a scoped commit costs more argv (status pathspec, then add) than the unscoped sweep.
const MAX_SCOPED_COMMIT_PATHS = 200;

type Committed = { files: number } | null;

export interface AutoCommitArgs {
  run: RunGitCommand;
  // the engine's repo lock, the one its sync pass takes: a second chain would let a flush land
  // inside a rebase.
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  deviceName: () => string;
  // awaited before every commit, which it refuses by throwing: a commit over an integration a
  // crash left open would seal its conflict markers into history.
  beforeCommit: () => Promise<void>;
  onError?: ((message: string) => void) | undefined;
  onStatusChanged?: (() => void) | undefined;
  quietMs?: number | undefined;
  maxWaitMs?: number | undefined;
}

export interface CommitHold {
  // the paths the holding turn wrote, which a checkpoint leaves to the turn's own commit.
  claim: (paths: readonly string[]) => void;
  release: () => void;
}

export interface AutoCommit {
  schedule: (paths?: readonly string[]) => void;
  commitNow: (paths?: readonly string[]) => Promise<Committed>;
  commitPaths: (
    paths: readonly string[],
    author: CommitAuthor,
    subject: string,
  ) => Promise<Committed>;
  hold: () => CommitHold;
  checkpointUnclaimed: () => Promise<Committed>;
  claimedPaths: () => string[];
  // unlocked: for a caller that already holds the lock, as a sync pass does.
  commitIfDirty: () => Promise<Committed>;
  // reported ahead of a pass's verdict until a flush or a whole-tree commit lands: a tree the
  // auto-commit left dirty says why nowhere else, and a vault with no remote runs no pass.
  flushError: () => string | null;
  held: () => boolean;
  // flush, never cancel: the debounce dies with the process. a failed flush rejects so the
  // shutdown exit code can name it.
  dispose: () => Promise<void>;
}

export const createAutoCommit = (args: AutoCommitArgs): AutoCommit => {
  const { run } = args;
  let flushError: string | null = null;
  let disposed = false;

  const commit = async (subject: string, author?: CommitAuthor): Promise<void> => {
    await run(["commit", "-m", subject], {
      env: identityEnv(args.deviceName(), author),
    });
  };

  const clearFlushError = (): void => {
    if (flushError !== null) {
      flushError = null;
      args.onStatusChanged?.();
    }
  };

  // a whole-tree commit that succeeds leaves nothing a failed flush stranded, whoever ran it: a
  // sync pass or a checkpoint clears the report as a later flush would.
  const commitIfDirty = async (): Promise<Committed> => {
    await args.beforeCommit();
    const dirty = entryPaths(await readPorcelain(run));
    if (dirty.length === 0) {
      clearFlushError();
      return null;
    }
    // unscoped: the scoped form passes every path as argv, and a large vault's first commit
    // would exceed ARG_MAX.
    await run(["add", "-A"]);
    await commit(vaultCommitSubject(dirty));
    clearFlushError();
    return { files: dirty.length };
  };

  const commitPathsIfDirty = async (
    paths: readonly string[],
    author: CommitAuthor | undefined,
    subject: (dirty: readonly string[]) => string,
  ): Promise<Committed> => {
    if (paths.length === 0) {
      return null;
    }
    await args.beforeCommit();
    // git add errors on a pathspec matching nothing, and a reported write may have been reverted.
    const dirty = entryPaths(await readPorcelain(run, paths));
    if (dirty.length === 0) {
      return null;
    }
    // -A with a pathspec stages deletions under it too; the commit takes only the index.
    await run(["add", "-A", "--", ...dirty]);
    await commit(subject(dirty), author);
    return { files: dirty.length };
  };

  // each live hold's claims. a held flush is re-armed on release; the release path's own
  // commitPaths usually beats it.
  const liveHolds = new Set<Set<string>>();
  let flushDeferredWhileHeld = false;

  const claimedPaths = (): string[] => [
    ...new Set([...liveHolds].flatMap((claims) => [...claims])),
  ];

  const stagedPaths = async (paths: readonly string[] = []): Promise<string[]> => {
    const { stdout } = await run([
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--no-renames",
      "--",
      ...paths,
    ]);
    return stdout.split("\0").filter((staged) => staged.length > 0);
  };

  const commitUnclaimed = async (): Promise<Committed> => {
    const claimed = claimedPaths();
    if (claimed.length === 0) {
      return await commitIfDirty();
    }
    await args.beforeCommit();
    // an :(exclude) pathspec is magic, which --literal-pathspecs turns off, and naming every
    // unclaimed path is the argv a large vault's first commit would overflow: the whole tree is
    // staged and the claims taken back out.
    await run(["add", "-A"]);
    const claimedStaged = await stagedPaths(claimed);
    if (claimedStaged.length > 0) {
      await run(["reset", "-q", "--", ...claimedStaged]);
    }
    const staged = await stagedPaths();
    if (staged.length === 0) {
      return null;
    }
    await commit(vaultCommitSubject(staged));
    return { files: staged.length };
  };

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
      await args.lock(async () =>
        scoped === null
          ? await commitIfDirty()
          : await commitPathsIfDirty([...scoped], undefined, vaultCommitSubject),
      );
    } catch (error) {
      // whatever failed is still dirty and its paths are spent: the next flush sweeps everything.
      pendingCommitPaths = null;
      flushError = error instanceof Error ? error.message : "auto-commit failed";
      args.onError?.(flushError);
      args.onStatusChanged?.();
      return;
    }
    clearFlushError();
  };

  const commitScheduler = createDebouncedCallbackScheduler({
    debounceMs: args.quietMs ?? AUTO_COMMIT_QUIET_MS,
    maxWaitMs: args.maxWaitMs ?? AUTO_COMMIT_MAX_WAIT_MS,
    onFlush: () => {
      if (disposed) {
        return;
      }
      if (liveHolds.size > 0) {
        flushDeferredWhileHeld = true;
        return;
      }
      const scoped = pendingCommitPaths;
      pendingCommitPaths = new Set();
      void flushCommit(scoped);
    },
  });

  const hold = (): CommitHold => {
    const claims = new Set<string>();
    liveHolds.add(claims);
    return {
      claim(paths) {
        if (!liveHolds.has(claims)) {
          return;
        }
        for (const claimed of paths) {
          claims.add(claimed);
        }
      },
      release() {
        if (!liveHolds.delete(claims)) {
          return;
        }
        if (liveHolds.size === 0 && flushDeferredWhileHeld) {
          flushDeferredWhileHeld = false;
          commitScheduler.schedule();
        }
      },
    };
  };

  return {
    async checkpointUnclaimed() {
      return await args.lock(commitUnclaimed);
    },
    claimedPaths,
    commitIfDirty,
    async commitNow(paths) {
      return await args.lock(
        async () =>
          await (paths === undefined
            ? commitIfDirty()
            : commitPathsIfDirty(paths, undefined, vaultCommitSubject)),
      );
    },
    async commitPaths(paths, author, subject) {
      return await args.lock(async () => await commitPathsIfDirty(paths, author, () => subject));
    },
    async dispose() {
      disposed = true;
      commitScheduler.dispose();
      await args.lock(async () => await commitIfDirty());
    },
    flushError: () => flushError,
    held: () => liveHolds.size > 0,
    hold,
    schedule(paths) {
      if (!disposed) {
        noteCommitPaths(paths);
        commitScheduler.schedule();
      }
    },
  };
};
