import { existsSync } from "node:fs";
import path from "node:path";
import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/api/cloud/vault/vault-git";
import type {
  ExternalSync,
  VaultConflict,
  VaultDeletedEntry,
  VaultRevision,
  VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import { ownOriginUrl } from "../cloud/vault-remote";
import type { OriginConfig, VaultRemoteProvider, VaultRemoteSpec } from "../cloud/vault-remote";
import { readOriginConfig, REMOTE_MARKER_ACCOUNT, REMOTE_MARKER_KEY } from "./folder-facts";
import { ACCOUNT_MARKER_KEY } from "./git-bootstrap";
import {
  cachedDeletionLog,
  readDeletedNotes,
  readNoteHistory,
  readNoteRevision,
  readTurnCommits,
} from "./git-history";
import type { NoteHistoryPage, TurnCommit } from "./git-history";
import { entryPaths, isUnmerged, readPorcelain } from "./git-porcelain";
import type { PorcelainEntry } from "./git-porcelain";
import {
  classifyNetworkFailure,
  gitPath,
  identityEnv,
  isMissingRemoteRef,
  NETWORK_GIT_TIMEOUT_MS,
  packExceeds,
  redactRemoteUrl,
  runGit,
} from "./git-run";
import type { CommitAuthor, NetworkFailure, RunGitOptions } from "./git-run";
import type { VaultFilesChange } from "./vault-changes";
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
  // asked every pass, over the vault's origin read then, so a sign-in, a sign-out or a remote the
  // user sets in the vault takes effect without a restart.
  remote: VaultRemoteProvider;
  // the service that syncs the folder instead, which the no-remote status names.
  externalSync?: ExternalSync | null;
  // fired on a sync transition, never on a commit that lands: the state is dirty on both sides
  // of a commit, and each announcement costs every client a porcelain read under the repo lock.
  // a flush that fails, and the commit that lands after it, move the reported error, so both fire.
  onStatusChanged?: () => void;
  // fired mid-pass, when a rebase moved the tree.
  onFilesChanged?: (change: VaultFilesChange) => void;
  onError?: (message: string) => void;
  quietMs?: number;
  maxWaitMs?: number;
  env?: Record<string, string>;
  // the account remote's push cap; unset, the hosted vault's own.
  maxPushBytes?: number;
}

interface CommitHold {
  // the paths the holding turn wrote, which a checkpoint leaves to the turn's own commit.
  claim: (paths: readonly string[]) => void;
  release: () => void;
}

export interface GitEngine {
  // the flush stages the window's union of paths; no paths means "whatever is dirty" and makes
  // the whole window's flush unscoped. a change nobody announced waits for a whole-tree caller
  // (a sync pass, an unscoped commitNow, a turn's checkpoint, shutdown, the next boot).
  scheduleCommit: (paths?: readonly string[]) => void;
  // with paths, only those, as the engine and allowed under a hold: a checkpoint of one note must
  // leave a running turn's writes to the turn's own commit. without, the whole dirty tree.
  commitNow: (paths?: readonly string[]) => Promise<{ files: number } | null>;
  // stages adds, edits and deletions under the paths, never the whole dirty tree; allowed
  // under a hold, being the hold's release path.
  commitPaths: (
    paths: readonly string[],
    author: CommitAuthor,
    subject: string,
  ) => Promise<{ files: number } | null>;
  // counted: overlapping turns each take their own hold and claim their own writes.
  holdCommits: () => CommitHold;
  // the dirty tree less every live claim, as the engine and allowed under a hold: a turn starts
  // here, so the parent of its commit holds whatever the user had not yet committed.
  checkpointUnclaimed: () => Promise<{ files: number } | null>;
  claimedPaths: () => string[];
  // off the repo lock: log and cat-file never touch the index. a read inside a rebase sees its
  // temporary head.
  history: (path: string, page: NoteHistoryPage) => Promise<VaultRevision[]>;
  revision: (path: string, sha: string) => Promise<string>;
  deleted: () => Promise<VaultDeletedEntry[]>;
  turnCommits: (threadId: string, sinceMs: number) => Promise<TurnCommit[]>;
  syncNow: () => Promise<VaultStatusResponse>;
  status: () => Promise<VaultStatusResponse>;
  // what the next pass would sync with, read as a pass reads it.
  currentRemote: () => Promise<VaultRemoteSpec | null>;
  isSyncing: () => boolean;
  // vault mutations run through this so a write cannot interleave a rebase's checkout/abort window.
  runExclusive: <T>(work: () => Promise<T>) => Promise<T>;
  startAutoSync: (intervalMs: number) => void;
  dispose: () => Promise<void>;
}

// the tips a conflict was met between: while neither moves, a rebase would only replay the same
// conflict through the worktree, rewriting every file it touches on every pass.
interface RecordedConflict {
  conflict: VaultConflict;
  head: string;
  remote: string;
}

// where a push the remote refused as too large was met. while the remote tip stands and the
// branch only grew from the refused head, every pack a push would send holds the refused one, so
// the pass skips a push that could only upload the same refusal again.
interface RefusedPush {
  url: string;
  head: string;
  remote: string | null;
}

const pushTooLargeMessage = (remote: VaultRemoteSpec, maxPushBytes: number): string =>
  remote.source === "account"
    ? `This vault's unsynced history is over the hosted vault's ` +
      `${String(maxPushBytes / (1024 * 1024))} MiB push limit.`
    : "The git remote refused the push as too large.";

// what the latest pass to reach a verdict concluded; a pass that ends before one (a pending
// account, a hold taken during its fetch, a dispose) leaves the last one standing. "none" leaves
// the report to the tree. "broken" is final: no pass runs after it. "account-mismatch" runs no
// network step, since a push would upload this vault into an account that never held it.
// "unreachable" outranks the tree because a failed fetch leaves the tracking ref stale, so
// "unpushed" would read clean.
type SyncOutcome =
  | { kind: "none" }
  | { kind: "broken" }
  | { kind: "conflict"; recorded: RecordedConflict }
  | { kind: "account-mismatch" }
  | { kind: "detached" }
  | { kind: "unreachable"; failure: NetworkFailure };

export const createGitEngine = (args: GitEngineArgs): GitEngine => {
  const { root } = args;
  const extraEnv = args.env ?? {};
  const maxPushBytes = args.maxPushBytes ?? VAULT_GIT_MAX_PUSH_BYTES;
  const externalSync = args.externalSync ?? null;

  let lastSyncAt: number | null = null;
  let lastError: string | null = null;
  // reported ahead of lastError until a flush or a whole-tree commit lands: a tree the
  // auto-commit left dirty says why nowhere else, and a vault with no remote runs no pass.
  let flushError: string | null = null;
  let lastOutcome: SyncOutcome = { kind: "none" };
  let refusedPush: RefusedPush | null = null;
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

  const deletionLog = cachedDeletionLog(run);

  // a pass reads under the repo lock, the one the origin and its marker are written under, so a
  // change to both lands whole on one side of its read. a status or a gate reads off it: one
  // written half-way still names the same remote, and a pass reads again before it acts.
  const readRemote = async (): Promise<{
    origin: OriginConfig;
    remote: VaultRemoteSpec | null;
  }> => {
    const origin = await readOriginConfig(run);
    return { origin, remote: args.remote(origin) };
  };

  const currentRemote = async (): Promise<VaultRemoteSpec | null> => {
    const { remote } = await readRemote();
    return remote;
  };

  const runNetwork = async (gitArgs: readonly string[], env?: Record<string, string>) => {
    const options: RunGitOptions = { timeoutMs: NETWORK_GIT_TIMEOUT_MS };
    if (env) {
      options.env = env;
    }
    return await run(gitArgs, options);
  };

  const recordNetworkFailure = (failure: NetworkFailure | "lost-race"): void => {
    // a remote that did not answer says nothing about the tips a recorded conflict was met
    // between, so the conflict stands; a lost race leaves the tree to say "unpushed".
    if (failure !== "lost-race" && lastOutcome.kind !== "conflict") {
      lastOutcome = { failure, kind: "unreachable" };
    }
  };

  const porcelain = async (paths: readonly string[] = []): Promise<PorcelainEntry[]> =>
    await readPorcelain(run, paths);

  const commit = async (subject: string, author?: CommitAuthor): Promise<void> => {
    await run(["-c", "commit.gpgsign=false", "commit", "-m", subject], {
      env: identityEnv(author),
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
  const commitIfDirty = async (): Promise<{ files: number } | null> => {
    const dirty = entryPaths(await porcelain());
    if (dirty.length === 0) {
      clearFlushError();
      return null;
    }
    // unscoped: the scoped form passes every path as argv, and a large vault's first commit
    // would exceed ARG_MAX.
    await run(["add", "-A"]);
    await commit(autoCommitSubject(dirty));
    clearFlushError();
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
    await commit(subject instanceof Function ? subject(dirty) : subject, author);
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

  const commitUnclaimed = async (): Promise<{ files: number } | null> => {
    const claimed = claimedPaths();
    if (claimed.length === 0) {
      return await commitIfDirty();
    }
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
    await commit(autoCommitSubject(staged));
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
      await withRepoLock(async () =>
        scoped === null
          ? await commitIfDirty()
          : await commitPathsIfDirty([...scoped], undefined, autoCommitSubject),
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

  const holdCommits = (): CommitHold => {
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

  // the origin is the vault's own record of where it syncs, so the app marks the origin it manages
  // and drops the mark when an explicit remote takes it over.
  const ensureOriginRemote = async (
    remote: VaultRemoteSpec,
    origin: OriginConfig,
  ): Promise<void> => {
    // "--" so the url can never read as an option.
    if (origin.url === null) {
      await run(["remote", "add", "--", "origin", remote.url]);
    } else if (origin.url !== remote.url) {
      await run(["remote", "set-url", "--", "origin", remote.url]);
    }
    const managed = remote.source === "account";
    if (managed && !origin.markedAccount) {
      await run(["config", REMOTE_MARKER_KEY, REMOTE_MARKER_ACCOUNT]);
    } else if (!managed && origin.markedAccount) {
      await run(["config", "--unset-all", REMOTE_MARKER_KEY]);
    }
  };

  let rebaseStateDirs: readonly string[] | null = null;
  const rebaseInProgress = async (): Promise<boolean> => {
    rebaseStateDirs ??= [
      await gitPath(run, root, "rebase-merge"),
      await gitPath(run, root, "rebase-apply"),
    ];
    return rebaseStateDirs.some((dir) => existsSync(dir));
  };

  const revListCount = async (range: string): Promise<number> => {
    const { stdout } = await run(["rev-list", "--count", range]);
    return Math.trunc(Number(stdout.trim())) || 0;
  };

  const revParse = async (rev: string): Promise<string> => {
    const { stdout } = await run(["rev-parse", rev]);
    return stdout.trim();
  };

  // what `push origin <branch>` sends, against the tip it is measured from.
  const pushTips = async (
    branch: string,
    remoteHasBranch: boolean,
  ): Promise<Omit<RefusedPush, "url">> => ({
    head: await revParse(`refs/heads/${branch}`),
    remote: remoteHasBranch ? await revParse(`refs/remotes/origin/${branch}`) : null,
  });

  // a failed check reads as "not an ancestor", which resends the push: the answer a doubt earns.
  const isAncestor = async (ancestor: string, rev: string): Promise<boolean> => {
    try {
      await run(["merge-base", "--is-ancestor", ancestor, rev]);
      return true;
    } catch {
      return false;
    }
  };

  // under the lock, before the push. true ends the pass on the refusal already recorded.
  const repeatsRefusedPush = async (
    remote: VaultRemoteSpec,
    branch: string,
    remoteHasBranch: boolean,
  ): Promise<boolean> => {
    const refused = refusedPush;
    if (refused === null || refused.url !== remote.url) {
      return false;
    }
    const tips = await pushTips(branch, remoteHasBranch);
    if (tips.remote !== refused.remote || !(await isAncestor(refused.head, tips.head))) {
      return false;
    }
    lastOutcome = { failure: "too-large", kind: "unreachable" };
    lastError = pushTooLargeMessage(remote, maxPushBytes);
    return true;
  };

  // off the lock, like the push it stands in front of: the hosted vault refuses a pack over its
  // cap only once the whole body has arrived. the on-disk estimate is cheap and loose, so only a
  // push near the cap pays for packing what it would send; a measurement that fails answers null
  // and the push goes, with the remote's own 413 behind it. answers the tips it measured.
  const measuredOverCap = async (
    branch: string,
    remoteHasBranch: boolean,
  ): Promise<Omit<RefusedPush, "url"> | null> => {
    const tips = await withRepoLock(async () => await pushTips(branch, remoteHasBranch));
    const revisions = tips.remote === null ? [tips.head] : [tips.head, `^${tips.remote}`];
    try {
      const { stdout } = await run(["rev-list", "--objects", "--disk-usage", ...revisions]);
      if (Number(stdout.trim()) < maxPushBytes / 2) {
        return null;
      }
      const over = await packExceeds(root, revisions, maxPushBytes, {
        env: extraEnv,
        timeoutMs: NETWORK_GIT_TIMEOUT_MS,
      });
      return over ? tips : null;
    } catch {
      return null;
    }
  };

  // what a rebase from a clean tree rewrote on disk. --no-renames: a moved note is a path gone
  // and a path added, and a consumer has to hear about both.
  const reportMovedTree = async (from: string, to: string): Promise<void> => {
    let paths: string[];
    try {
      const { stdout } = await run(["diff", "--name-only", "-z", "--no-renames", from, to, "--"]);
      paths = stdout.split("\0").filter((changed) => changed.length > 0);
    } catch {
      args.onFilesChanged?.({ kind: "unknown" });
      return;
    }
    if (paths.length > 0) {
      args.onFilesChanged?.({ kind: "paths", paths });
    }
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
  const recoverFailedRebase = async (
    branch: string,
    tips: { head: string; remote: string },
  ): Promise<"recorded" | "unhandled"> => {
    // git's own unmerged set, read before the abort wipes it.
    const conflictFiles = (await rebaseInProgress()) ? await unmergedPathsOr([]) : [];
    if (await rebaseInProgress()) {
      // never leave the repo mid-rebase.
      await run(["rebase", "--abort"]).catch(() => {
        /* empty */
      });
    }
    // a swallowed failed abort would leave every later commit landing in rebase state.
    const stillUnmerged = await unmergedPathsOr(["unknown"]);
    if ((await rebaseInProgress()) || stillUnmerged.length > 0) {
      lastOutcome = { kind: "broken" };
      lastError =
        `a failed rebase could not be aborted; manual recovery needed: ` +
        `run \`git rebase --abort\` in ${root}, then restart inteligir`;
      // a tree left mid-rebase is no diff between two commits. a clean abort needs no report:
      // it puts back the tree the pass started from.
      args.onFilesChanged?.({ kind: "unknown" });
      return "recorded";
    }
    if (conflictFiles.length > 0) {
      const remoteRef = `refs/remotes/origin/${branch}`;
      const conflict: VaultConflict = {
        files: conflictFiles,
        ours: { commits: await revListCount(`${remoteRef}..HEAD`).catch(() => 0) },
        theirs: { commits: await revListCount(`HEAD..${remoteRef}`).catch(() => 0) },
      };
      lastOutcome = { kind: "conflict", recorded: { ...tips, conflict } };
      return "recorded";
    }
    return "unhandled";
  };

  // under the lock, before the fetch. answers the remote and the branch to sync, or null to end the
  // pass. the remote is asked again here, so an origin changed since the caller's read is this
  // pass's, never overwritten by it.
  const preparePass = async (): Promise<{ remote: VaultRemoteSpec; branch: string } | null> => {
    const { origin, remote } = await readRemote();
    if (remote === null) {
      return null;
    }
    if (remote.source === "account") {
      // the provider hands out the account remote only past an origin of the user's own; were one
      // here anyway, the set-url below would push the user's repo into the hosted vault.
      const own = ownOriginUrl(origin, remote.url);
      if (own !== null) {
        lastError =
          `origin is ${redactRemoteUrl(own)}, a remote of the vault's own; this pass left it ` +
          "alone and did not sync with the account's hosted vault";
        return null;
      }
      if (remote.account.state === "pending") {
        // fail closed: a pass now would skip the marker check, the window a new sign-in pushes
        // the old vault through. the thread sync retries the account fetch and pings this
        // engine when it lands.
        return null;
      }
      const marker = await readAccountMarker();
      if (marker !== null && marker !== remote.account.id) {
        lastOutcome = { kind: "account-mismatch" };
        lastError =
          "This vault last synced with a different account. Sign out, or move this vault aside " +
          "and restart to pull the new account's vault.";
        return null;
      }
    }
    await commitIfDirty();
    await ensureOriginRemote(remote, origin);
    const branch = await currentBranch();
    if (branch === null) {
      lastOutcome = { kind: "detached" };
      lastError = "vault HEAD is detached; sync needs a branch";
      return null;
    }
    // past the fence and on a branch: neither of this step's own verdicts holds any more.
    if (lastOutcome.kind === "account-mismatch" || lastOutcome.kind === "detached") {
      lastOutcome = { kind: "none" };
    }
    return { branch, remote };
  };

  // under the lock, between the fetch and the push. false ends the pass before its push.
  const integrateFetched = async (branch: string, remoteHasBranch: boolean): Promise<boolean> => {
    // the lock was free across the fetch: a turn may have taken its hold and begun writing,
    // and a dispose may have run the final flush.
    if (disposed || liveHolds.size > 0) {
      return false;
    }
    // a save that landed during the fetch would refuse the rebase as unstaged changes.
    await commitIfDirty();
    if (!remoteHasBranch) {
      return true;
    }
    const remoteRef = `refs/remotes/origin/${branch}`;
    const tips = { head: await revParse("HEAD"), remote: await revParse(remoteRef) };
    if (
      lastOutcome.kind === "conflict" &&
      lastOutcome.recorded.head === tips.head &&
      lastOutcome.recorded.remote === tips.remote
    ) {
      return false;
    }
    try {
      // --empty=drop: a local commit already landed upstream would otherwise halt the merge
      // backend as a conflict naming no files.
      // a replayed commit is committed anew, and git refuses to guess a committer on a host
      // whose name carries no domain (a Linux box, a container); the authors stay the originals.
      await run(["-c", "commit.gpgsign=false", "rebase", "--empty=drop", remoteRef], {
        env: identityEnv(),
      });
    } catch (error) {
      if ((await recoverFailedRebase(branch, tips)) === "unhandled") {
        throw error;
      }
      return false;
    }
    // the push decides what this pass reports.
    lastOutcome = { kind: "none" };
    const head = await revParse("HEAD");
    if (head !== tips.head) {
      await reportMovedTree(tips.head, head);
    }
    return true;
  };

  // the network steps run off the repo lock: a fetch or push on a dropped network waits out its
  // timeout, and under the lock every save and every turn start would wait with it.
  const doSync = async (): Promise<void> => {
    const prepared = await withRepoLock(preparePass);
    if (prepared === null) {
      return;
    }
    const { branch, remote } = prepared;

    let remoteHasBranch = true;
    try {
      await runNetwork(["fetch", "origin", branch], remote.env);
    } catch (error) {
      if (!isMissingRemoteRef(error)) {
        recordNetworkFailure(classifyNetworkFailure(error));
        throw error;
      }
      // a fresh remote: the push below creates the branch. it answered, and it holds nothing a
      // recorded conflict could be about.
      lastOutcome = { kind: "none" };
      remoteHasBranch = false;
    }

    const pushing = await withRepoLock(
      async () =>
        (await integrateFetched(branch, remoteHasBranch)) &&
        !(await repeatsRefusedPush(remote, branch, remoteHasBranch)),
    );
    if (!pushing) {
      return;
    }

    if (remote.source === "account") {
      const overCap = await measuredOverCap(branch, remoteHasBranch);
      if (overCap !== null) {
        recordNetworkFailure("too-large");
        refusedPush = { url: remote.url, ...overCap };
        throw new Error(pushTooLargeMessage(remote, maxPushBytes));
      }
    }

    try {
      await runNetwork(["push", "origin", branch], remote.env);
    } catch (error) {
      const failure = classifyNetworkFailure(error);
      recordNetworkFailure(failure);
      if (failure !== "too-large") {
        throw error;
      }
      // read after the refusal: the branch only grows past what the push sent, and a head that
      // holds the refused one is as large.
      const tips = await withRepoLock(async () => await pushTips(branch, remoteHasBranch));
      refusedPush = { url: remote.url, ...tips };
      throw new Error(pushTooLargeMessage(remote, maxPushBytes), { cause: error });
    }
    refusedPush = null;
    if (remote.source === "account" && remote.account.state === "known") {
      const accountId = remote.account.id;
      await withRepoLock(async () => {
        if ((await readAccountMarker()) === null) {
          await run(["config", ACCOUNT_MARKER_KEY, accountId]);
        }
      });
    }
    lastOutcome = { kind: "none" };
    lastSyncAt = Date.now();
    lastError = null;
  };

  // behind the repo lock so a status never reports a sync's half-way tree.
  const treeState = async (): Promise<"clean" | "dirty"> =>
    await withRepoLock(async () => {
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
      return dirtyPaths > 0 || unpushed > 0 ? "dirty" : "clean";
    });

  const statusSnapshot = async (): Promise<VaultStatusResponse> => {
    const remote = await currentRemote();
    const reportedError = flushError ?? lastError;
    if (remote === null) {
      return { externalSync, lastError: reportedError, lastSyncAt, state: "no-remote" };
    }
    const fields = {
      lastError: reportedError,
      lastSyncAt,
      // redacted: an https remote carries the token, and this string reaches logs and the ui.
      remote: redactRemoteUrl(remote.url),
      remoteSource: remote.source,
    };
    if (syncing) {
      return { ...fields, state: "syncing" };
    }
    const outcome = lastOutcome;
    // a verdict about the repo outranks a hold, and a hold outranks the rest: under a hold or
    // after a failed fetch, clean/dirty would be a claim about the remote this engine cannot make.
    if (outcome.kind === "broken") {
      return { ...fields, state: "broken" };
    }
    if (outcome.kind === "conflict") {
      return { ...fields, conflict: outcome.recorded.conflict, state: "conflict" };
    }
    if (liveHolds.size > 0) {
      return { ...fields, state: "held" };
    }
    switch (outcome.kind) {
      case "account-mismatch": {
        return { ...fields, state: "account-mismatch" };
      }
      case "detached": {
        return { ...fields, state: "detached" };
      }
      case "unreachable": {
        return { ...fields, state: outcome.failure };
      }
      case "none": {
        return { ...fields, state: await treeState() };
      }
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  };

  const runSyncPass = async (): Promise<void> => {
    try {
      await doSync();
    } catch (error) {
      lastError = error instanceof Error ? error.message : "sync failed";
      args.onError?.(lastError);
    }
  };

  const syncNow = async (): Promise<VaultStatusResponse> => {
    if (inflightSync !== null) {
      return await inflightSync;
    }
    // claimed before the gate's read, so a second caller joins this one rather than passing the
    // gate beside it.
    const pass = (async () => {
      try {
        // a pass starts by committing the dirty tree, which a hold exists to prevent; the
        // snapshot says "held" rather than reporting clean as if a pass ran.
        const remote = await currentRemote();
        if (remote === null || lastOutcome.kind === "broken" || liveHolds.size > 0) {
          return await statusSnapshot();
        }
        syncing = true;
        args.onStatusChanged?.();
        await runSyncPass();
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
    async checkpointUnclaimed() {
      return await withRepoLock(commitUnclaimed);
    },
    claimedPaths,
    currentRemote,
    async commitNow(paths?: readonly string[]) {
      return await withRepoLock(
        async () =>
          await (paths === undefined
            ? commitIfDirty()
            : commitPathsIfDirty(paths, undefined, autoCommitSubject)),
      );
    },
    async commitPaths(paths, author, subject) {
      return await withRepoLock(async () => await commitPathsIfDirty(paths, author, subject));
    },
    async deleted() {
      return await readDeletedNotes(run, deletionLog, (notePath) =>
        existsSync(path.join(root, notePath)),
      );
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
    async turnCommits(threadId, sinceMs) {
      return await readTurnCommits(run, { since: sinceMs, threadId });
    },
  };
};
