// One responsibility: the vault's git ENGINE — the auto-commit debounce, the
// commit hold, and the sync loop (fetch → rebase → push against the
// configured remote), serialized behind one repo lock. A refused rebase is
// always aborted — the repo is never left mid-rebase — and surfaces as a
// typed conflict state instead.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  VaultConflict,
  VaultRevision,
  VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import type { VaultRemoteProvider, VaultRemoteSpec } from "../cloud/vault-remote";
import { ACCOUNT_MARKER_KEY } from "./git-bootstrap";
import { readNoteHistory, readNoteRevision, type NoteHistoryPage } from "./git-history";
import { entryPaths, isUnmerged, readPorcelain, type PorcelainEntry } from "./git-porcelain";
import {
  identityEnv,
  isAuthRefusal,
  isMissingRemoteRef,
  NETWORK_GIT_TIMEOUT_MS,
  redactRemoteUrl,
  runGit,
  type CommitAuthor,
  type RunGitOptions,
} from "./git-run";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";

/**
 * SESSION-SHAPED COMMITS, and the numbers are the decision.
 *
 * The log has to be ANSWERABLE — "restore the version from before I rewrote
 * the intro" cannot be served by thirty anonymous revisions a few seconds
 * apart. So a pause of 15 seconds is what ends an editing session, and
 * continuous typing still lands a revision every minute.
 *
 * What that trades is granularity against how long an edit sits UNCOMMITTED,
 * and the second half is smaller than it looks: the editor's autosave is
 * 600ms, so the bytes are on disk the whole time — what waits is the
 * revision, not the data. The max wait is the SYNC INTERVAL, because a sync
 * pass commits the dirty tree before it pushes — so with a remote configured
 * that was already the bound, and this makes a local-only vault behave the
 * same. Every other path closes the gap besides: `commitNow` and shutdown
 * flush, and the boot sweep catches whatever a crash left.
 */
const AUTO_COMMIT_QUIET_MS = 15_000;
const AUTO_COMMIT_MAX_WAIT_MS = 60_000;

/** Past this many known paths a scoped commit stops being the cheap one: every
 *  path is an argv entry twice over, and the unscoped sweep has no such bound. */
const MAX_SCOPED_COMMIT_PATHS = 200;

/**
 * The subject an auto-commit takes. A single-file commit NAMES ITS FILE:
 * `vault: update 1 files` is browsable and unanswerable, and one word of the
 * path is what makes `git log --follow --oneline` legible at a glance.
 */
function autoCommitSubject(paths: readonly string[]): string {
  const only = paths.length === 1 ? paths[0] : undefined;
  return only === undefined
    ? `vault: update ${String(paths.length)} files`
    : `vault: update ${only}`;
}

export interface GitEngineArgs {
  root: string;
  /**
   * Where the remote comes from, re-read at every pass and status read — so a
   * pairing that derives one (or an unpair that removes it) flips sync live,
   * with no engine restart. null = local-only: commits still happen, the sync
   * loop stays idle.
   */
  remote: VaultRemoteProvider;
  /**
   * Fired on every sync-status TRANSITION, which is a sync starting and a sync
   * ending — and not a commit. A commit only ever runs with something dirty,
   * so the state before it was `dirty`; the commit it makes is by construction
   * unpushed, so the state after it is `dirty` too (`held` on both sides under
   * an agent's hold, `no-remote` on both without a remote). Announcing it made
   * every client re-fetch the status, and every fetch is a `git status
   * --porcelain` plus a `rev-list` under the repo lock, to be told the same
   * word twice.
   */
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
  /**
   * Debounced: a burst of writes lands as ONE commit after the quiet window.
   * `paths` is what the caller KNOWS moved, and the flush stages exactly the
   * union of what the window collected — a whole-tree `status` + `add -A` is
   * two full worktree scans to commit one saved note. Calling with no paths
   * means "whatever is dirty", which is what the boot sweep and the post-sync
   * drain mean, and one such call makes the whole window's flush unscoped.
   *
   * What that trades, stated: a change nobody announced is not in the union,
   * so it waits for a caller that means the whole tree — a sync pass, an
   * explicit `commitNow`, shutdown, or the next boot. Both producers of vault
   * changes DO announce (the service's own mutations and the watcher's
   * batches), so the gap is the watcher having failed — by which point the
   * file tree and the knowledge index have already stopped being current.
   */
  scheduleCommit(paths?: readonly string[]): void;
  /** Commit whatever is dirty right now, as the engine; null when the tree was
   *  clean. Attributed work goes through `commitPaths` instead. */
  commitNow(): Promise<{ files: number } | null>;
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
   * mid-turn. Counted — overlapping turns each take their own hold — and
   * `commitPaths` still runs under a hold (that IS the release path's commit).
   * Returns the release function.
   */
  holdCommits(): () => void;
  /**
   * The note's own commits, newest first, ACROSS RENAMES. Empty for a path
   * git has never seen.
   *
   * OFF THE REPO LOCK, unlike every mutation here. `log` and `cat-file` read
   * the object database and never the index, so they can neither corrupt nor
   * be corrupted by a commit — while the lock they would take is the same
   * chain a whole sync pass holds, network calls and their 120-second timeout
   * included. Queueing a click behind that is the worse answer. The residual
   * is stated: a read landing inside a rebase sees that rebase's temporary
   * HEAD, and the next refetch corrects it.
   */
  history(path: string, page: NoteHistoryPage): Promise<VaultRevision[]>;
  /** The bytes the note held at one revision, read at that revision's own
   *  path. Refuses `not_found` / `too_large` exactly as a disk read does. */
  revision(path: string, sha: string): Promise<string>;
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
  const extraEnv = args.env ?? {};

  let lastSyncAt: number | null = null;
  let lastError: string | null = null;
  let lastConflict: VaultConflict | null = null;
  /** Set when a failed rebase could not be aborted; syncs stop until repaired. */
  let broken = false;
  /**
   * What the last network invocation's failure WAS, or null after one that
   * succeeded. One value rather than two booleans because the two outcomes
   * mask each other's fix — "offline" heals on its own while "unauthorized"
   * (a revoked device) refuses every retry until a re-pair — and the latest
   * outcome is the only truth: a refusal followed by a dead network must
   * read offline, not still-unauthorized. Also why the status cannot come
   * from the porcelain read: "unpushed" is measured against the
   * remote-tracking ref, which a failed fetch leaves exactly where it was,
   * so a vault with nothing local to push would answer `clean` ("Synced")
   * while the remote is unreachable and may have moved.
   */
  let networkFailure: "offline" | "unauthorized" | null = null;
  /**
   * The paired remote belongs to a DIFFERENT account than the one this
   * checkout last synced with (the `inteligir.account` marker). Evaluated at
   * the top of every paired pass; while true no network invocation runs —
   * pushing would upload this vault's notes into an account that never held
   * them, which is the one thing a re-pair must not do silently.
   */
  let accountMismatch = false;
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

  /** The two invocations that actually dial the remote. A failure here is
   *  what `networkFailure` records; every other git call is local. `env`
   *  carries the remote's own auth (the provider's header env). */
  async function runNetwork(gitArgs: readonly string[], env?: Record<string, string>) {
    try {
      const options: RunGitOptions = { timeoutMs: NETWORK_GIT_TIMEOUT_MS };
      if (env) options.env = env;
      return await run(gitArgs, options);
    } catch (error) {
      networkFailure = isAuthRefusal(error) ? "unauthorized" : "offline";
      throw error;
    }
  }

  function porcelain(paths: readonly string[] = []): Promise<PorcelainEntry[]> {
    return readPorcelain(run, paths);
  }

  async function commitIfDirty(): Promise<{ files: number } | null> {
    const dirty = entryPaths(await porcelain());
    if (dirty.length === 0) {
      return null;
    }
    // `add -A` unscoped, deliberately: the scoped form passes every path as an
    // argument, and the first commit of a large vault would exceed ARG_MAX.
    await run(["add", "-A"]);
    await run(["-c", "commit.gpgsign=false", "commit", "-m", autoCommitSubject(dirty)], {
      env: identityEnv(),
    });
    return { files: dirty.length };
  }

  async function commitPathsIfDirty(
    paths: readonly string[],
    author: CommitAuthor | undefined,
    subject: string | ((dirty: readonly string[]) => string),
  ): Promise<{ files: number } | null> {
    if (paths.length === 0) {
      return null;
    }
    // Restrict the pathspec to what is actually dirty: `git add` errors on a
    // pathspec matching nothing, and a reported write may have been reverted.
    const dirty = entryPaths(await porcelain(paths));
    if (dirty.length === 0) {
      return null;
    }
    // -A with a pathspec stages deletions under it too; the commit takes only
    // the index, so everything else dirty stays for its own commit.
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
  }

  // An agent turn holds commits so its writes cannot be swept into an
  // engine-attributed commit mid-turn; the flush the hold deflected is
  // re-armed on release (the release path's own commitPaths usually beat it,
  // making the re-armed flush a clean-tree no-op).
  let commitHoldCount = 0;
  let flushDeferredWhileHeld = false;

  /** What the next flush stages: the union of the paths its schedulers named,
   *  or null for "whatever is dirty" — the boot sweep and the post-sync drain
   *  both mean that, and one of them in the window decides the whole flush. */
  let pendingCommitPaths: Set<string> | null = new Set();

  function noteCommitPaths(paths: readonly string[] | undefined): void {
    if (paths === undefined || pendingCommitPaths === null) {
      pendingCommitPaths = null;
      return;
    }
    for (const path of paths) {
      pendingCommitPaths.add(path);
    }
    // Every path becomes an argv entry twice (the status pathspec, then the
    // add); past a point the unscoped sweep is both cheaper and safe.
    if (pendingCommitPaths.size > MAX_SCOPED_COMMIT_PATHS) {
      pendingCommitPaths = null;
    }
  }

  const commitScheduler = createDebouncedCallbackScheduler({
    debounceMs: args.quietMs ?? AUTO_COMMIT_QUIET_MS,
    maxWaitMs: args.maxWaitMs ?? AUTO_COMMIT_MAX_WAIT_MS,
    onFlush: () => {
      if (disposed) {
        return;
      }
      if (commitHoldCount > 0) {
        // The paths stay pending: the release re-arms this same flush.
        flushDeferredWhileHeld = true;
        return;
      }
      const scoped = pendingCommitPaths;
      pendingCommitPaths = new Set();
      void withRepoLock(() =>
        scoped === null
          ? commitIfDirty()
          : commitPathsIfDirty([...scoped], undefined, autoCommitSubject),
      ).catch((cause: unknown) => {
        // Whatever failed is still dirty and its paths are spent, so the next
        // flush has to be the one that sweeps everything.
        pendingCommitPaths = null;
        args.onError?.(cause instanceof Error ? cause.message : "auto-commit failed");
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

  /** The files git itself marks unmerged (UU/AA/DD/…). */
  async function unmergedPaths(): Promise<string[]> {
    return (await porcelain())
      .filter(isUnmerged)
      .map((entry) => entry.path)
      .toSorted();
  }

  /** The checkout's account marker, or null before the first paired sync. */
  async function readAccountMarker(): Promise<string | null> {
    try {
      const { stdout } = await run(["config", "--get", ACCOUNT_MARKER_KEY]);
      const value = stdout.trim();
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }

  async function doSync(remote: VaultRemoteSpec): Promise<void> {
    if (remote.source === "paired" && remote.account === undefined) {
      // FAIL CLOSED, quietly: the session has not learned WHOSE account this
      // credential is yet (the /v1/account fetch is in flight, or the cloud
      // predates the route). A pass that ran now would skip the marker check
      // below — exactly the window a re-pair pushes the old vault through.
      // Every thread sync pass retries that fetch while the id is missing, and
      // the one that lands pings this engine.
      return;
    }
    if (remote.source === "paired" && remote.account !== undefined) {
      const marker = await readAccountMarker();
      if (marker !== null && marker !== remote.account) {
        accountMismatch = true;
        // A conflict from the PREVIOUS account describes files in a repo this
        // pass will not touch, and `statusSnapshot` ranks conflict above
        // mismatch — so leaving it set answers "both sides changed the same
        // files" to a condition whose only fix is unpairing.
        lastConflict = null;
        lastError =
          "This vault last synced with a different account. Unpair, or move this vault aside " +
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
      // A fresh remote: nothing to rebase onto, the push below creates it.
      // The remote ANSWERED, so this is not an unreachable one.
      networkFailure = null;
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

    await runNetwork(["push", "origin", branch], remote.env);
    if (remote.source === "paired" && remote.account !== undefined) {
      // Pin the account whose repo this push landed in; the fence above
      // compares every later pass against it.
      const marker = await readAccountMarker();
      if (marker === null) {
        await run(["config", ACCOUNT_MARKER_KEY, remote.account]);
      }
    }
    lastConflict = null;
    lastSyncAt = Date.now();
    lastError = null;
    networkFailure = null;
  }

  async function statusSnapshot(): Promise<VaultStatusResponse> {
    const currentRemote = args.remote();
    if (currentRemote === null) {
      return { state: "no-remote", lastSyncAt, lastError };
    }
    // Status responses carry the redacted remote: an https remote is where a
    // token rides, and this string reaches logs and the UI.
    const remote = redactRemoteUrl(currentRemote.url);
    const remoteSource = currentRemote.source;
    if (syncing) {
      return { state: "syncing", remote, remoteSource, lastSyncAt, lastError };
    }
    if (broken) {
      return { state: "broken", remote, remoteSource, lastSyncAt, lastError };
    }
    if (lastConflict !== null) {
      return {
        state: "conflict",
        remote,
        remoteSource,
        conflict: lastConflict,
        lastSyncAt,
        lastError,
      };
    }
    // These outrank the porcelain read below, because each means the
    // clean/dirty answer would be a claim about the remote that this engine
    // cannot make: no pass may start under a hold, and a failed network
    // invocation left the tracking ref stale (`networkFailure`'s own note).
    if (commitHoldCount > 0) {
      return { state: "held", remote, remoteSource, lastSyncAt, lastError };
    }
    if (accountMismatch) {
      return { state: "account-mismatch", remote, remoteSource, lastSyncAt, lastError };
    }
    if (networkFailure !== null) {
      return { state: networkFailure, remote, remoteSource, lastSyncAt, lastError };
    }
    // The porcelain reads run behind the repo lock, so a status can never
    // report the half-way tree of a sync or commit in flight.
    return withRepoLock(async () => {
      const dirtyPaths = await porcelain()
        .then((entries) => entries.length)
        .catch(() => 0);
      let unpushed = 0;
      if (dirtyPaths === 0) {
        const branch = await currentBranch();
        if (branch !== null) {
          // No remote-tracking ref yet means everything local is unpushed.
          unpushed = await revListCount(`refs/remotes/origin/${branch}..HEAD`).catch(() => 1);
        }
      }
      if (dirtyPaths > 0 || unpushed > 0) {
        return { state: "dirty", remote, remoteSource, lastSyncAt, lastError };
      }
      return { state: "clean", remote, remoteSource, lastSyncAt, lastError };
    });
  }

  function syncNow(): Promise<VaultStatusResponse> {
    if (inflightSync !== null) {
      return inflightSync;
    }
    // A sync pass starts by committing the dirty tree, which is exactly what
    // a commit hold exists to prevent; the interval retries after release.
    // The snapshot SAYS so (`held`) rather than answering as if a pass ran —
    // a "Sync now" that reported `clean` here would be a silent no-op. The
    // provider is read ONCE for the pass, so the gate and the pass cannot
    // disagree about which remote (or credential) this pass is under.
    const remote = args.remote();
    if (remote === null || broken || commitHoldCount > 0) {
      return statusSnapshot();
    }
    syncing = true;
    args.onStatusChanged?.();
    const pass = withRepoLock(() => doSync(remote))
      .catch((cause: unknown) => {
        lastError = cause instanceof Error ? cause.message : "sync failed";
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
    scheduleCommit(paths?: readonly string[]) {
      if (!disposed) {
        noteCommitPaths(paths);
        commitScheduler.schedule();
      }
    },
    commitNow() {
      return withRepoLock(() => commitIfDirty());
    },
    commitPaths(paths, author, subject) {
      return withRepoLock(() => commitPathsIfDirty(paths, author, subject));
    },
    holdCommits,
    history(path, page) {
      return readNoteHistory(run, path, page);
    },
    revision(path, sha) {
      return readNoteRevision(run, path, sha);
    },
    syncNow,
    status: statusSnapshot,
    isSyncing: () => syncing,
    runExclusive: withRepoLock,
    startAutoSync(intervalMs: number) {
      // Armed even with no remote right now: the provider is live, so a
      // pairing minted after boot starts syncing on the next tick. A tick
      // with none is one provider read.
      if (disposed || autoSyncTimer !== null) {
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
      // A failed flush REJECTS — the vault teardown step is the one this
      // whole ordering protects, and the shutdown exit code has to be able
      // to name it.
      await withRepoLock(() => commitIfDirty());
    },
  };
}
