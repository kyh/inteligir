import { existsSync } from "node:fs";
import path from "node:path";
import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/contract/cloud/vault/vault-git";
import { VAULT_SYNC_CONFLICTS_MAX } from "@repo/contract/local/vault/vault-schema";
import type {
  ExternalSync,
  VaultDeletedEntry,
  VaultRevision,
  VaultSetRemoteRequest,
  VaultStatusResponse,
  VaultSyncConflict,
} from "@repo/contract/local/vault/vault-schema";
import type { SyncConflictReport } from "@repo/notes/sync/conflict-copy";
import { reconcileFile } from "@repo/notes/sync/reconcile-file";
import { ownOriginUrl } from "../cloud/vault-remote";
import type { OriginConfig, VaultRemoteProvider, VaultRemoteSpec } from "../cloud/vault-remote";
import { messageOf } from "../error-message";
import { readOriginConfig } from "./folder-facts";
import { ACCOUNT_MARKER_KEY, SEED_COMMIT_KEY } from "./git-bootstrap";
import {
  cachedDeletionLog,
  readDeletedNotes,
  readNoteHistory,
  readNoteRevision,
  readTurnCommits,
} from "./git-history";
import type { NoteHistoryPage, TurnCommit } from "./git-history";
import { mergeFetched, mergeInProgress, pulledCopies } from "./git-merge";
import type { Reconcile } from "./git-merge";
import { createAutoCommit } from "./git-commits";
import type { CommitHold } from "./git-commits";
import { readPorcelain, unmergedPaths } from "./git-porcelain";
import {
  currentBranch,
  isAncestor,
  markOrigin,
  pointOrigin,
  readConfig,
  revListCount,
  revParse,
} from "./git-refs";
import {
  classifyNetworkFailure,
  gitAt,
  gitPath,
  identityEnv,
  isMissingRemoteRef,
  NETWORK_GIT_TIMEOUT_MS,
  redactRemoteUrl,
} from "./git-run";
import type { CommitAuthor, GitRunner, NetworkFailure } from "./git-run";
import type { VaultFilesChange } from "./vault-changes";

// the account remote's quiet tick: while its socket would ping this device for another device's
// push and nothing waits to go up, a tick reaches the hosted vault only this often, because every
// fetch is an operation the hosted vault bills. a ping, a sign-in and Sync now still reach it at once.
const ACCOUNT_QUIET_FETCH_MS = 15 * 60_000;

export interface GitEngineArgs {
  root: string;
  git: GitRunner;
  // asked every pass, over the vault's origin read then, so a sign-in, a sign-out or a remote the
  // user sets in the vault takes effect without a restart.
  remote: VaultRemoteProvider;
  // the committer of every commit this engine makes, asked at each: a merge on another device
  // names this one's version by it, and a sign-in may rename the device.
  deviceName: () => string;
  // the verdict a path both sides changed gets; a suite injects one that fails.
  reconcile?: Reconcile;
  // the service that syncs the folder, which every status names.
  externalSync?: ExternalSync | null | undefined;
  // fired on a sync transition, never on a commit that lands: the state is dirty on both sides
  // of a commit, and each announcement costs every client a porcelain read under the repo lock.
  // a flush that fails, and the commit that lands after it, move the reported error, so both fire.
  onStatusChanged?: () => void;
  // fired mid-pass, when a rebase or a merge moved the tree.
  onFilesChanged?: (change: VaultFilesChange) => void;
  onError?: (message: string) => void;
  // a pass's decision the log should name once, which no status carries.
  onNotice?: (message: string) => void;
  quietMs?: number;
  maxWaitMs?: number;
  // the account remote's push cap; unset, the hosted vault's own.
  maxPushBytes?: number;
  // whether another device's push to the account remote would ping this device now (its account
  // socket is up). unset or false, every tick fetches, as a remote that pings nobody needs.
  accountPingsReach?: (() => boolean) | undefined;
  // how long a tick may go without reaching a remote that pings; unset, ACCOUNT_QUIET_FETCH_MS.
  quietFetchMs?: number;
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
  // the one write to where the vault syncs, Settings' and the CLI's: it edits the origin every pass
  // reads, so a person's own `git remote` and the app never disagree. "pinned" changes nothing:
  // INTELIGIR_VAULT_REMOTE decides, and a pass would write it over the origin anyway.
  setOrigin: (choice: VaultSetRemoteRequest) => Promise<SetOriginOutcome>;
  isSyncing: () => boolean;
  // vault mutations run through this so a write cannot interleave a rebase's checkout/abort window.
  runExclusive: <T>(work: () => Promise<T>) => Promise<T>;
  startAutoSync: (intervalMs: number) => void;
  dispose: () => Promise<void>;
}

type SetOriginOutcome = "set" | "pinned";

// the tips a merge failed outright between: while neither moves, another try fails the same way.
interface IntegrationTips {
  head: string;
  remote: string;
}

const MERGE_FAILED_MESSAGE =
  "This device's changes and another device's could not be combined. Sync tries again once " +
  "either side changes.";

// where a push the remote refused was met, so the pass skips a push that could only upload the
// same refusal again. too large: while the remote tip stands and the branch only grew from the
// refused head, every pack a push would send holds the refused one. full: while the remote tip
// stands, no pack fits, since the remote frees nothing on its own.
interface PushTips {
  head: string;
  remote: string | null;
}

type RefusedPush =
  | ({ failure: "too-large"; url: string } & PushTips)
  | { failure: "full"; url: string; remote: string | null };

const refusedPushMessage = (
  remote: VaultRemoteSpec,
  failure: RefusedPush["failure"],
  maxPushBytes: number,
): string => {
  const account = remote.source === "account";
  if (failure === "full") {
    return account
      ? "Your cloud vault is full. New changes stay on this Mac."
      : "Your sync server is out of space.";
  }
  return account
    ? `This vault's unsynced history is over the hosted vault's ` +
        `${String(maxPushBytes / (1024 * 1024))} MiB push limit.`
    : "The git remote refused the push as too large.";
};

// the build floor is the cloud's: a 426 from a remote of the user's own is that server refusing
const failureFrom = (
  remote: VaultRemoteSpec,
  failure: NetworkFailure | "lost-race",
): NetworkFailure | "lost-race" =>
  failure === "outdated" && remote.source !== "account" ? "rejected" : failure;

// what the latest pass to reach a verdict concluded, with the words the status reports for it, so
// a verdict and its message can never disagree. a pass that ends before its fetch answers (a build
// the cloud refused) leaves the last one standing; one whose fetch answers starts over from "none",
// which leaves the report to the tree, even when a hold or a dispose then ends it before its push.
// "broken" is final: no pass runs after it. "account-mismatch" runs no network step, since a push
// would upload this vault into an account that never held it. "unreachable" outranks the tree
// because a failed fetch leaves the tracking ref stale, so "unpushed" would read clean. "stalled"
// is a pass that failed short of any other verdict: left to the tree, it would read clean or dirty
// and say nothing of the failure.
type SyncOutcome =
  | { kind: "none"; message: null }
  | { kind: "broken"; message: string }
  | { kind: "account-mismatch"; message: string }
  | { kind: "detached"; message: string }
  | { kind: "stalled"; message: string }
  | { kind: "unreachable"; failure: NetworkFailure; message: string };

const NO_OUTCOME = { kind: "none", message: null } as const satisfies SyncOutcome;

export const createGitEngine = (args: GitEngineArgs): GitEngine => {
  const { git, root } = args;
  const maxPushBytes = args.maxPushBytes ?? VAULT_GIT_MAX_PUSH_BYTES;
  const externalSync = args.externalSync ?? null;

  let lastSyncAt: number | null = null;
  let outcome: SyncOutcome = NO_OUTCOME;
  // memos, not verdicts: each outlives the passes that go offline meanwhile, so the pass skips a
  // push or a merge that could only fail the same way again.
  let refusedPush: RefusedPush | null = null;
  let failedMerge: IntegrationTips | null = null;
  // newest first, since boot
  let conflicts: VaultSyncConflict[] = [];
  let syncing = false;
  let disposed = false;
  let inflightSync: Promise<VaultStatusResponse> | null = null;
  let syncAgain = false;
  // set by every caller but the timer: a ping, a sign-in, Sync now and the boot pass reach the remote.
  let forceNetwork = false;
  const quietFetchMs = args.quietFetchMs ?? ACCOUNT_QUIET_FETCH_MS;
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

  const run = gitAt(git, root);

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

  const runNetwork = async (gitArgs: readonly string[], env?: Record<string, string>) =>
    await run(gitArgs, { env, timeoutMs: NETWORK_GIT_TIMEOUT_MS });

  // a failure the pass met on the network and could name, said once to the log. a lost race is no
  // failure of the remote: the tree says "unpushed", and the next pass rebases onto the push that
  // won, so it reports no error.
  const recordNetworkFailure = (failure: NetworkFailure | "lost-race", message: string): void => {
    args.onError?.(message);
    outcome = failure === "lost-race" ? NO_OUTCOME : { failure, kind: "unreachable", message };
  };

  const recordRefusedPush = (remote: VaultRemoteSpec, refused: RefusedPush["failure"]): void => {
    const message = refusedPushMessage(remote, refused, maxPushBytes);
    args.onError?.(message);
    outcome = { failure: refused, kind: "unreachable", message };
  };

  let rebaseStateDirs: readonly string[] | null = null;
  const rebaseInProgress = async (): Promise<boolean> => {
    rebaseStateDirs ??= [
      await gitPath(run, root, "rebase-merge"),
      await gitPath(run, root, "rebase-apply"),
    ];
    return rebaseStateDirs.some((dir) => existsSync(dir));
  };

  // only a pass starts a rebase or a merge, under the lock, and it ends either before letting go,
  // so one is open before this engine's first commit only when a crash left it, and after that
  // only when a pass could not abort its own. committing over it would seal git's conflict
  // markers into history, or land on a rebase's detached head.
  let mayBeMidIntegration = true;
  const clearInterruptedIntegration = async (): Promise<void> => {
    if (!mayBeMidIntegration) {
      return;
    }
    if (await mergeInProgress({ run })) {
      await run(["merge", "--abort"]).catch(() => {
        /* checked below */
      });
    }
    if (await rebaseInProgress()) {
      await run(["rebase", "--abort"]).catch(() => {
        /* checked below */
      });
    }
    if ((await mergeInProgress({ run })) || (await rebaseInProgress())) {
      const message =
        `an interrupted merge or rebase could not be aborted; manual recovery needed: run ` +
        `\`git merge --abort\` or \`git rebase --abort\` in ${root}, then restart inteligir`;
      outcome = { kind: "broken", message };
      throw new Error(message);
    }
    mayBeMidIntegration = false;
  };

  const autoCommit = createAutoCommit({
    beforeCommit: clearInterruptedIntegration,
    deviceName: args.deviceName,
    lock: withRepoLock,
    maxWaitMs: args.maxWaitMs,
    onError: args.onError,
    onStatusChanged: args.onStatusChanged,
    quietMs: args.quietMs,
    run,
  });

  const ensureOriginRemote = async (
    remote: VaultRemoteSpec,
    origin: OriginConfig,
  ): Promise<void> => {
    await pointOrigin(run, origin.url, remote.url);
    await markOrigin(run, remote.source === "account", origin);
  };

  // the account choice drops only an origin the provider calls the user's own: the app's own stays
  // for the next signed-in pass, and the mark keeps it the app's. signed out, no pass adds one.
  const writeOrigin = async (choice: VaultSetRemoteRequest): Promise<SetOriginOutcome> => {
    const { origin, remote } = await readRemote();
    if (remote?.source === "pinned") {
      return "pinned";
    }
    if (choice.kind === "remote") {
      await pointOrigin(run, origin.url, choice.url);
      await markOrigin(run, false, origin);
    } else {
      if (origin.url !== null && remote?.source === "explicit") {
        await run(["remote", "remove", "origin"]);
      }
      await markOrigin(run, true, origin);
    }
    // what a pass concluded about the old remote says nothing of the new one; a repo left
    // mid-integration is broken whichever remote it syncs with.
    if (outcome.kind !== "broken") {
      outcome = NO_OUTCOME;
    }
    failedMerge = null;
    return "set";
  };

  const setOrigin = async (choice: VaultSetRemoteRequest): Promise<SetOriginOutcome> => {
    const written = await withRepoLock(async () => await writeOrigin(choice));
    if (written === "set") {
      args.onStatusChanged?.();
    }
    return written;
  };

  // what `push origin <branch>` sends, against the tip it is measured from.
  const pushTips = async (branch: string, remoteHasBranch: boolean): Promise<PushTips> => ({
    head: await revParse(run, `refs/heads/${branch}`),
    remote: remoteHasBranch ? await revParse(run, `refs/remotes/origin/${branch}`) : null,
  });

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
    if (tips.remote !== refused.remote) {
      return false;
    }
    if (refused.failure === "too-large" && !(await isAncestor(run, refused.head, tips.head))) {
      return false;
    }
    outcome = {
      failure: refused.failure,
      kind: "unreachable",
      message: refusedPushMessage(remote, refused.failure, maxPushBytes),
    };
    return true;
  };

  // off the lock, like the push it stands in front of: the hosted vault refuses a pack over its
  // cap only once the whole body has arrived. the on-disk estimate is cheap and loose, so only a
  // push near the cap pays for packing what it would send; a measurement that fails answers null
  // and the push goes, with the remote's own 413 behind it. answers the tips it measured.
  const measuredOverCap = async (
    branch: string,
    remoteHasBranch: boolean,
  ): Promise<PushTips | null> => {
    const tips = await withRepoLock(async () => await pushTips(branch, remoteHasBranch));
    const revisions = tips.remote === null ? [tips.head] : [tips.head, `^${tips.remote}`];
    try {
      const { stdout } = await run(["rev-list", "--objects", "--disk-usage", ...revisions]);
      if (Number(stdout.trim()) < maxPushBytes / 2) {
        return null;
      }
      const over = await git.packExceeds(root, revisions, maxPushBytes, {
        timeoutMs: NETWORK_GIT_TIMEOUT_MS,
      });
      return over ? tips : null;
    } catch {
      return null;
    }
  };

  // what a rebase or a merge from a clean tree rewrote on disk. --no-renames: a moved note is a
  // path gone and a path added, and a consumer has to hear about both.
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

  const readAccountMarker = async (): Promise<string | null> =>
    await readConfig(run, ACCOUNT_MARKER_KEY);

  // a tree left mid-rebase or mid-merge is no diff between two commits. a clean abort needs no
  // report: it puts back the tree the pass started from.
  const markBroken = (step: "merge" | "rebase"): void => {
    outcome = {
      kind: "broken",
      message:
        `a failed ${step} could not be aborted; manual recovery needed: ` +
        `run \`git ${step} --abort\` in ${root}, then restart inteligir`,
    };
    mayBeMidIntegration = true;
    args.onFilesChanged?.({ kind: "unknown" });
  };

  // the repo is left off its rebase either way. "conflicted" is a rebase that stopped on paths
  // both sides changed, which the pass merges instead; "unhandled" is the caller's cue to rethrow.
  const recoverFailedRebase = async (): Promise<"conflicted" | "broken" | "unhandled"> => {
    // git's own unmerged set, read before the abort wipes it.
    const stopped = (await rebaseInProgress()) ? await unmergedPaths(run).catch(() => []) : [];
    if (await rebaseInProgress()) {
      // never leave the repo mid-rebase.
      await run(["rebase", "--abort"]).catch(() => {
        /* empty */
      });
    }
    // a swallowed failed abort would leave every later commit landing in rebase state.
    const stillUnmerged = await unmergedPaths(run).catch(() => ["unknown"]);
    if ((await rebaseInProgress()) || stillUnmerged.length > 0) {
      markBroken("rebase");
      return "broken";
    }
    return stopped.length > 0 ? "conflicted" : "unhandled";
  };

  const recordConflicts = (reports: readonly SyncConflictReport[]): void => {
    if (reports.length === 0) {
      return;
    }
    const at = Date.now();
    conflicts = [...reports.map((report) => ({ ...report, at })), ...conflicts].slice(
      0,
      VAULT_SYNC_CONFLICTS_MAX,
    );
  };

  // a rebase keeps the history a line, so it goes first; it replays commits one by one and drops
  // a merge commit, so a branch still holding an unpushed merge merges again rather than lose it.
  // answers what the merge settled, or null when the pass ends here.
  const integrate = async (
    remoteRef: string,
    tips: IntegrationTips,
  ): Promise<SyncConflictReport[] | null> => {
    const { stdout: unpushedMerge } = await run([
      "rev-list",
      "--merges",
      "--max-count=1",
      `${remoteRef}..HEAD`,
    ]);
    if (unpushedMerge.trim() === "") {
      try {
        // --empty=drop: a local commit already landed upstream would otherwise halt the merge
        // backend as a conflict naming no files.
        await run(["rebase", "--empty=drop", remoteRef], {
          env: identityEnv(args.deviceName()),
        });
        return [];
      } catch (error) {
        const recovered = await recoverFailedRebase();
        if (recovered === "broken") {
          return null;
        }
        if (recovered === "unhandled") {
          throw error;
        }
      }
    }
    try {
      return await mergeFetched(
        { readBlob: async (oid) => await git.readBlob(root, oid), run },
        { device: args.deviceName(), reconcile: args.reconcile ?? reconcileFile, remoteRef },
      );
    } catch (error) {
      if (await mergeInProgress({ run })) {
        markBroken("merge");
        return null;
      }
      failedMerge = tips;
      outcome = { kind: "stalled", message: MERGE_FAILED_MESSAGE };
      args.onError?.(`${MERGE_FAILED_MESSAGE} (${messageOf(error)})`);
      return null;
    }
  };

  // a tick that may leave the account remote alone: its socket would have pinged a push from
  // another device, the last pass that reached it ended clean and recently, and the commit just
  // made (if any) is already there. the tracking ref is gone after any move of the origin.
  const quietTickCanWait = async (remote: VaultRemoteSpec, branch: string): Promise<boolean> => {
    if (
      remote.source !== "account" ||
      args.accountPingsReach?.() !== true ||
      outcome.kind !== "none" ||
      lastSyncAt === null ||
      Date.now() - lastSyncAt >= quietFetchMs
    ) {
      return false;
    }
    try {
      return (
        (await revParse(run, "HEAD")) === (await revParse(run, `refs/remotes/origin/${branch}`))
      );
    } catch {
      return false;
    }
  };

  // under the lock, before the fetch. answers the remote and the branch to sync, or null to end the
  // pass, as a tick `quietTickCanWait` excuses is. the remote is asked again here, so an origin
  // changed since the caller's read is this pass's, never overwritten by it.
  const preparePass = async (
    forced: boolean,
  ): Promise<{ remote: VaultRemoteSpec; branch: string } | null> => {
    const { origin, remote } = await readRemote();
    if (remote === null) {
      return null;
    }
    if (remote.source === "account") {
      // the provider hands out the account remote only past an origin of the user's own; were one
      // here anyway, the set-url below would push the user's repo into the hosted vault.
      const own = ownOriginUrl(origin, remote.url);
      if (own !== null) {
        outcome = {
          kind: "stalled",
          message:
            `origin is ${redactRemoteUrl(own)}, a remote of the vault's own; this pass left it ` +
            "alone and did not sync with the account's hosted vault",
        };
        return null;
      }
      // the cloud refused this build, and only another build, which is another process, gets past
      // its floor: a retry here would be refused the same way every interval
      if (outcome.kind === "unreachable" && outcome.failure === "outdated") {
        return null;
      }
      const marker = await readAccountMarker();
      if (marker !== null && marker !== remote.accountId) {
        outcome = {
          kind: "account-mismatch",
          message:
            "This vault last synced with a different account. Sign out, or move this vault " +
            "aside and restart to pull the new account's vault.",
        };
        return null;
      }
    }
    await autoCommit.commitIfDirty();
    await ensureOriginRemote(remote, origin);
    const branch = await currentBranch(run);
    if (branch === null) {
      outcome = { kind: "detached", message: "vault HEAD is detached; sync needs a branch" };
      return null;
    }
    if (!forced && (await quietTickCanWait(remote, branch))) {
      return null;
    }
    return { branch, remote };
  };

  // a history that is still the commit the bootstrap seeded holds nothing of the user's, and
  // merging it into a remote with history of its own would keep each starter over the user's
  // version of it, copy theirs aside and bring back every starter they deleted. so the branch
  // takes the remote's tip whole, through git's own checkout, which writes nothing through a
  // symlink and refuses to overwrite a change landed since the pass's commit (the next pass
  // commits that change and merges). a HEAD moved off the seed drops the record. answers whether
  // the branch moved.
  const yieldSeededHistory = async (
    remote: VaultRemoteSpec,
    branch: string,
    remoteRef: string,
    tips: IntegrationTips,
  ): Promise<boolean> => {
    const seed = await readConfig(run, SEED_COMMIT_KEY);
    if (seed === null) {
      return false;
    }
    if (seed !== tips.head) {
      await run(["config", "--unset-all", SEED_COMMIT_KEY]);
      return false;
    }
    await run(["checkout", "-q", "--no-track", "-B", branch, remoteRef, "--"]);
    await reportMovedTree(tips.head, tips.remote);
    await run(["config", "--unset-all", SEED_COMMIT_KEY]);
    args.onNotice?.(
      `this vault held only its starter notes, so it took the history of ` +
        `${redactRemoteUrl(remote.url)} in their place rather than merging the two`,
    );
    return true;
  };

  // the copies this integration brought in that it did not make. two histories joined for the first
  // time share no base, so every file the remote held arrives as added, every old copy among them:
  // only the join's own verdicts are news. the pull already landed; a report it could not read
  // costs only the report.
  const copiesPulledSince = async (
    tips: IntegrationTips,
    head: string,
    settled: readonly SyncConflictReport[],
  ): Promise<SyncConflictReport[]> => {
    const base = await run(["merge-base", tips.head, tips.remote]).catch(() => null);
    if (base === null) {
      return [];
    }
    const madeHere = new Set(
      settled.flatMap((report) => (report.kind === "copied" ? [report.copyPath] : [])),
    );
    return await pulledCopies(run, tips.head, head, madeHere).catch(() => []);
  };

  // under the lock, between the fetch and the push. false ends the pass before its push.
  const integrateFetched = async (
    remote: VaultRemoteSpec,
    branch: string,
    remoteHasBranch: boolean,
  ): Promise<boolean> => {
    // the lock was free across the fetch: a turn may have taken its hold and begun writing,
    // and a dispose may have run the final flush.
    if (disposed || autoCommit.held()) {
      return false;
    }
    // a save that landed during the fetch would refuse the rebase as unstaged changes.
    await autoCommit.commitIfDirty();
    if (!remoteHasBranch) {
      return true;
    }
    const remoteRef = `refs/remotes/origin/${branch}`;
    const tips: IntegrationTips = {
      head: await revParse(run, "HEAD"),
      remote: await revParse(run, remoteRef),
    };
    if (await isAncestor(run, tips.remote, tips.head)) {
      return true;
    }
    if (await yieldSeededHistory(remote, branch, remoteRef, tips)) {
      return true;
    }
    if (failedMerge?.head === tips.head && failedMerge.remote === tips.remote) {
      outcome = { kind: "stalled", message: MERGE_FAILED_MESSAGE };
      return false;
    }
    failedMerge = null;
    const settled = await integrate(remoteRef, tips);
    if (settled === null) {
      return false;
    }
    const head = await revParse(run, "HEAD");
    if (head !== tips.head) {
      await reportMovedTree(tips.head, head);
      recordConflicts([...settled, ...(await copiesPulledSince(tips, head, settled))]);
    }
    return true;
  };

  // answers whether the push landed: a refusal or a failure is recorded where it is met.
  const pushBranch = async (
    remote: VaultRemoteSpec,
    branch: string,
    remoteHasBranch: boolean,
  ): Promise<boolean> => {
    if (remote.source === "account") {
      const overCap = await measuredOverCap(branch, remoteHasBranch);
      if (overCap !== null) {
        refusedPush = { failure: "too-large", url: remote.url, ...overCap };
        recordRefusedPush(remote, "too-large");
        return false;
      }
    }

    try {
      await runNetwork(["push", "origin", branch], remote.env);
    } catch (error) {
      const failure = failureFrom(remote, classifyNetworkFailure(error));
      if (failure !== "too-large" && failure !== "full") {
        recordNetworkFailure(failure, messageOf(error));
        return false;
      }
      // read after the refusal: the branch only grows past what the push sent, and a head that
      // holds the refused one is as large.
      const tips = await withRepoLock(async () => await pushTips(branch, remoteHasBranch));
      refusedPush =
        failure === "full"
          ? { failure, remote: tips.remote, url: remote.url }
          : { failure, url: remote.url, ...tips };
      recordRefusedPush(remote, failure);
      return false;
    }
    return true;
  };

  // the network steps run off the repo lock: a fetch or push on a dropped network waits out its
  // timeout, and under the lock every save and every turn start would wait with it.
  const doSync = async (forced: boolean): Promise<void> => {
    const prepared = await withRepoLock(async () => await preparePass(forced));
    if (prepared === null) {
      return;
    }
    const { branch, remote } = prepared;

    let remoteHasBranch = true;
    try {
      await runNetwork(["fetch", "origin", branch], remote.env);
    } catch (error) {
      if (!isMissingRemoteRef(error)) {
        recordNetworkFailure(failureFrom(remote, classifyNetworkFailure(error)), messageOf(error));
        return;
      }
      // a fresh remote: the push below creates the branch.
      remoteHasBranch = false;
    }
    // the remote answered, so nothing an earlier pass concluded holds any more.
    outcome = NO_OUTCOME;

    // a push with nothing to send still asks the remote for its refs, an operation the hosted
    // vault bills like any other; a fetched tip that already holds HEAD is the push's own answer.
    const step = await withRepoLock(async (): Promise<"stop" | "push" | "in-sync"> => {
      if (!(await integrateFetched(remote, branch, remoteHasBranch))) {
        return "stop";
      }
      if (remoteHasBranch) {
        const tips = await pushTips(branch, true);
        if (tips.head === tips.remote) {
          return "in-sync";
        }
      }
      return (await repeatsRefusedPush(remote, branch, remoteHasBranch)) ? "stop" : "push";
    });
    if (step === "stop") {
      return;
    }
    if (step === "push" && !(await pushBranch(remote, branch, remoteHasBranch))) {
      return;
    }
    refusedPush = null;
    if (remote.source === "account") {
      const { accountId } = remote;
      await withRepoLock(async () => {
        if ((await readAccountMarker()) === null) {
          await run(["config", ACCOUNT_MARKER_KEY, accountId]);
        }
      });
    }
    lastSyncAt = Date.now();
  };

  // behind the repo lock so a status never reports a sync's half-way tree.
  const treeState = async (): Promise<"clean" | "dirty"> =>
    await withRepoLock(async () => {
      const dirtyPaths = await readPorcelain(run)
        .then((entries) => entries.length)
        .catch(() => 0);
      let unpushed = 0;
      if (dirtyPaths === 0) {
        const branch = await currentBranch(run);
        if (branch !== null) {
          // no remote-tracking ref yet means everything local is unpushed.
          unpushed = await revListCount(run, `refs/remotes/origin/${branch}..HEAD`).catch(() => 1);
        }
      }
      return dirtyPaths > 0 || unpushed > 0 ? "dirty" : "clean";
    });

  const statusSnapshot = async (): Promise<VaultStatusResponse> => {
    const remote = await currentRemote();
    // one read, so the state and its message are the same verdict's.
    const verdict = outcome;
    const statusFields = {
      conflicts,
      device: args.deviceName(),
      externalSync,
      lastError: autoCommit.flushError() ?? verdict.message,
      lastSyncAt,
      // PIVOT-STUB(S2): the files over the cap no commit stages (§2.6)
      tooLarge: { count: 0, files: [] },
    };
    if (remote === null) {
      return { ...statusFields, state: "no-remote" };
    }
    const fields = {
      ...statusFields,
      // redacted: an https remote carries the token, and this string reaches logs and the ui.
      remote: redactRemoteUrl(remote.url),
      remoteSource: remote.source,
    };
    if (syncing) {
      return { ...fields, state: "syncing" };
    }
    // a verdict about the repo outranks a hold, and a hold outranks the rest: under a hold or
    // after a failed fetch, clean/dirty would be a claim about the remote this engine cannot make.
    if (verdict.kind === "broken") {
      return { ...fields, state: "broken" };
    }
    if (autoCommit.held()) {
      return { ...fields, state: "held" };
    }
    switch (verdict.kind) {
      case "account-mismatch": {
        return { ...fields, state: "account-mismatch" };
      }
      case "detached": {
        return { ...fields, state: "detached" };
      }
      case "stalled": {
        return { ...fields, state: "stalled" };
      }
      case "unreachable": {
        return { ...fields, state: verdict.failure };
      }
      case "none": {
        // a failed flush leaves the tree dirty, which alone reads as edits on their way
        return {
          ...fields,
          state: autoCommit.flushError() === null ? await treeState() : "stalled",
        };
      }
      default: {
        const exhaustive: never = verdict;
        return exhaustive;
      }
    }
  };

  // every verdict a pass can name it records where it meets it; what throws is a failure short of
  // one (a save the engine could not record, an unclassified step), unless the repo was found
  // mid-integration, which already said broken.
  const runSyncPass = async (forced: boolean): Promise<void> => {
    try {
      await doSync(forced);
    } catch (error) {
      const message = messageOf(error);
      if (outcome.kind !== "broken") {
        outcome = { kind: "stalled", message };
      }
      args.onError?.(message);
    }
  };

  // coalescing: a caller mid-pass joins it and has it run once more before anyone hears back.
  // the running pass may have fetched before whatever that caller is about — another device's
  // push pings mid-pass — and joining alone would answer clean without it until the next tick.
  // `forced` is every caller but the timer's tick; a forced caller joining a tick's pass makes
  // the pass it waits on a forced one.
  const requestSync = async (forced: boolean): Promise<VaultStatusResponse> => {
    if (inflightSync !== null) {
      // a tick is answered by the pass already running; only a caller with news asks for another.
      if (forced) {
        forceNetwork = true;
        syncAgain = true;
      }
      return await inflightSync;
    }
    forceNetwork = forced;
    // claimed before the gate's read, so a second caller joins this one rather than passing the
    // gate beside it.
    const pass = (async () => {
      try {
        for (;;) {
          syncAgain = false;
          const passForced = forceNetwork;
          forceNetwork = false;
          // a pass starts by committing the dirty tree, which a hold exists to prevent; the
          // snapshot says "held" rather than reporting clean as if a pass ran.
          const remote = await currentRemote();
          if (remote === null || outcome.kind === "broken" || autoCommit.held()) {
            return await statusSnapshot();
          }
          syncing = true;
          args.onStatusChanged?.();
          await runSyncPass(passForced);
          syncing = false;
          args.onStatusChanged?.();
          // read before the decision: a caller joining while the snapshot waits on the repo lock
          // would otherwise be answered by a pass that had already chosen not to run again, and a
          // ping it carried would wait for the next pass that reaches the remote.
          const status = await statusSnapshot();
          if (!syncAgain || disposed) {
            return status;
          }
        }
      } finally {
        inflightSync = null;
      }
    })();
    inflightSync = pass;
    return await pass;
  };
  const syncNow = async (): Promise<VaultStatusResponse> => await requestSync(true);

  return {
    checkpointUnclaimed: autoCommit.checkpointUnclaimed,
    claimedPaths: autoCommit.claimedPaths,
    commitNow: autoCommit.commitNow,
    commitPaths: autoCommit.commitPaths,
    currentRemote,
    async deleted() {
      return await readDeletedNotes(run, deletionLog, (notePath) =>
        existsSync(path.join(root, notePath)),
      );
    },
    async dispose() {
      // first: a pass between its fetch and its integration reads it and stops.
      disposed = true;
      if (autoSyncTimer !== null) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
      }
      await autoCommit.dispose();
    },
    async history(notePath, page) {
      return await readNoteHistory(run, notePath, page);
    },
    holdCommits: autoCommit.hold,
    isSyncing: () => syncing,
    async revision(notePath, sha) {
      return await readNoteRevision(run, notePath, sha);
    },
    runExclusive: withRepoLock,
    setOrigin,
    scheduleCommit: autoCommit.schedule,
    startAutoSync(intervalMs: number) {
      // armed with no remote too: a sign-in after boot starts syncing on the next tick.
      if (disposed || autoSyncTimer !== null) {
        return;
      }
      autoSyncTimer = setInterval(() => {
        void requestSync(false);
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
