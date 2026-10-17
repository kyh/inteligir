import { vaultCommitSubject } from "@repo/contract/cloud/vault/vault-git";
import { VAULT_TOO_LARGE_LISTED } from "@repo/contract/local/vault/vault-schema";
import { identityEnv } from "./git-run";
import type { CommitAuthor, RunGitCommand } from "./git-run";
import {
  applyStaging,
  HISTORY_FILE_MAX_BYTES,
  planStaging,
  readStagingEntries,
  untrackSubject,
} from "./git-stage";
import type { SizedPath, StagingEntry, StagingLimits } from "./git-stage";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";

// a 15s pause ends an editing session, so the log stays answerable ("the version from before
// i rewrote the intro") rather than thirty anonymous revisions; the max wait is the sync
// interval, since a sync pass commits the dirty tree before it pushes.
const AUTO_COMMIT_QUIET_MS = 15_000;
const AUTO_COMMIT_MAX_WAIT_MS = 60_000;

// past this a window's commit is the whole dirty tree: a scoped status costs a pathspec per path.
const MAX_SCOPED_COMMIT_PATHS = 200;

type Committed = { files: number } | null;

// the files over the cap that stay on this Mac: every one counted, the first few named
export interface TooLargeFiles {
  count: number;
  files: SizedPath[];
}

export interface AutoCommitArgs {
  run: RunGitCommand;
  // the worktree, where each dirty path is measured before anything is staged
  root: string;
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
  // a suite's smaller budget and cap; unset, COMMIT_BUDGET_BYTES and HISTORY_FILE_MAX_BYTES
  staging?: Omit<StagingLimits, "leaveOut"> | undefined;
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
  // unlocked, like commitIfDirty: the dirty paths a commit would take, which leaves out a file
  // over the cap that is not in history, since no commit ever will. refreshes tooLarge.
  dirtyCount: () => Promise<number>;
  // what the last whole-tree read found over the cap; null before any read
  tooLarge: () => TooLargeFiles | null;
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

  // the files over the cap, by path, as the reads that covered them found them
  let oversized: Map<string, number> | null = null;

  // a read covers the paths it was scoped to (all when unscoped, all but the left-out ones at a
  // turn's start): what it did not find over the cap there no longer is
  const recordOversized = (
    entries: readonly StagingEntry[],
    covers: (path: string) => boolean,
    cap: number,
  ): void => {
    // a path the read covered and did not find over the cap is no longer, wherever it went
    const next = new Map(
      [...(oversized ?? new Map<string, number>())].filter(([path]) => !covers(path)),
    );
    for (const entry of entries) {
      if (covers(entry.path) && entry.bytes !== null && entry.bytes > cap) {
        next.set(entry.path, entry.bytes);
      }
    }
    oversized = next;
  };

  const capBytes = args.staging?.capBytes ?? HISTORY_FILE_MAX_BYTES;
  const limitsWith = (leaveOut?: ReadonlySet<string>): StagingLimits => {
    const limits: StagingLimits = { ...args.staging };
    if (leaveOut !== undefined) {
      limits.leaveOut = leaveOut;
    }
    return limits;
  };

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

  interface CommitScope {
    // absent: the whole dirty tree
    paths?: readonly string[];
    leaveOut?: ReadonlySet<string>;
    author?: CommitAuthor | undefined;
    subject: (staged: readonly string[]) => string;
  }

  const coversFor = (scope: CommitScope): ((path: string) => boolean) => {
    if (scope.paths === undefined) {
      const { leaveOut } = scope;
      return leaveOut === undefined ? () => true : (path) => !leaveOut.has(path);
    }
    const named = new Set(scope.paths);
    return (path) => {
      const segments = path.split("/");
      return segments.some((_, index) => named.has(segments.slice(0, index + 1).join("/")));
    };
  };

  // one plan per commit: the files that outgrew the cap leave history in a commit of their own,
  // then the scope's paths go in commits of at most the budget each, the rest following at once.
  // nothing is hashed before it is planned, so a file over the cap never reaches the object store.
  const commitPlanned = async (scope: CommitScope): Promise<Committed> => {
    await args.beforeCommit();
    let files = 0;
    let landed = false;
    let { paths } = scope;
    let first = true;
    for (;;) {
      const entries = await readStagingEntries(run, args.root, paths);
      const plan = planStaging(entries, limitsWith(scope.leaveOut));
      // the first read covers the scope; a later one only the rest it left, all within the cap
      if (first) {
        recordOversized(entries, coversFor(scope), capBytes);
        first = false;
      }
      if (plan.untrack.length > 0) {
        await applyStaging(run, { stage: [], untrack: plan.untrack });
        await commit(untrackSubject(plan.untrack));
        files += plan.untrack.length;
        landed = true;
      }
      if (plan.stage.length === 0) {
        break;
      }
      await applyStaging(run, { stage: plan.stage, untrack: [] });
      const staged = await stagedPaths();
      if (staged.length === 0) {
        break;
      }
      await commit(scope.subject(staged), scope.author);
      files += staged.length;
      landed = true;
      if (plan.rest.length === 0) {
        break;
      }
      paths = plan.rest;
    }
    return landed ? { files } : null;
  };

  // a whole-tree commit that succeeds leaves nothing a failed flush stranded, whoever ran it: a
  // sync pass or a checkpoint clears the report as a later flush would.
  const commitIfDirty = async (): Promise<Committed> => {
    const committed = await commitPlanned({ subject: vaultCommitSubject });
    clearFlushError();
    return committed;
  };

  const commitPathsIfDirty = async (
    paths: readonly string[],
    author: CommitAuthor | undefined,
    subject: (dirty: readonly string[]) => string,
  ): Promise<Committed> => {
    if (paths.length === 0) {
      return null;
    }
    return await commitPlanned({ author, paths, subject });
  };

  // each live hold's claims. a held flush is re-armed on release; the release path's own
  // commitPaths usually beats it.
  const liveHolds = new Set<Set<string>>();
  let flushDeferredWhileHeld = false;

  const claimedPaths = (): string[] => [
    ...new Set([...liveHolds].flatMap((claims) => [...claims])),
  ];

  // the dirty tree less every claim, named on stdin: an :(exclude) pathspec is magic, which
  // --literal-pathspecs turns off, and naming every unclaimed path in argv is what a large
  // vault's first commit would overflow.
  const commitUnclaimed = async (): Promise<Committed> => {
    const claimed = claimedPaths();
    if (claimed.length === 0) {
      return await commitIfDirty();
    }
    return await commitPlanned({ leaveOut: new Set(claimed), subject: vaultCommitSubject });
  };

  const dirtyCount = async (): Promise<number> => {
    const entries = await readStagingEntries(run, args.root);
    recordOversized(entries, () => true, capBytes);
    const plan = planStaging(entries, limitsWith());
    return plan.stage.length + plan.untrack.length + plan.rest.length;
  };

  const tooLarge = (): TooLargeFiles | null => {
    if (oversized === null) {
      return null;
    }
    const files = [...oversized.entries()]
      .map(([path, bytes]) => ({ bytes, path }))
      .toSorted((a, b) => a.path.localeCompare(b.path));
    return { count: files.length, files: files.slice(0, VAULT_TOO_LARGE_LISTED) };
  };

  // null means "whatever is dirty"; one unscoped call in the window decides the whole flush.
  let pendingCommitPaths: Set<string> | null = new Set();

  const addPendingCommitPaths = (paths: readonly string[] | undefined): void => {
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
    dirtyCount,
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
    tooLarge,
    schedule(paths) {
      if (!disposed) {
        addPendingCommitPaths(paths);
        commitScheduler.schedule();
      }
    },
  };
};
