// The vault's git engine, over the SYSTEM git binary (execFile, no shell).
// Owns repo init, the auto-commit debounce, and the sync loop
// (fetch → rebase → push against the configured remote). A refused rebase is
// always aborted — the repo is never left mid-rebase — and surfaces as a typed
// conflict state instead.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  VaultConflict,
  VaultRevision,
  VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import { VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import type { VaultRemoteProvider, VaultRemoteSpec } from "../cloud/vault-remote";
import { readNoteHistory, readNoteRevision, type NoteHistoryPage } from "./git-history";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";

const LOCAL_GIT_TIMEOUT_MS = 30_000;
const NETWORK_GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

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

/** One entry of `git status --porcelain`: the two status columns, the path,
 *  and — for a rename or copy — the path it came FROM. */
export interface PorcelainEntry {
  x: string;
  y: string;
  path: string;
  origin: string | null;
}

/**
 * THE reader of `git status --porcelain`, and the only one. Three callers used
 * to decode the same bytes three ways and disagreed about all of it: two split
 * on newlines and one on NUL, two required four characters and one accepted
 * any non-empty line, one understood rename entries and two did not. Two of
 * them therefore handed back git's C-QUOTED spelling (`"a\tb"`, and every
 * non-ASCII name) as if it were a path — a bug you cannot see until a vault
 * holds a filename with a space in it.
 *
 * `-z` is not an option here, it is the format: NUL-separated, never quoted,
 * with a rename's origin arriving as its own token. Every caller runs it, and
 * this is the one place that knows what comes back.
 */
export function parsePorcelain(stdout: string): PorcelainEntry[] {
  const tokens = stdout.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    // `XY <path>`: two status columns, a space, then the path. Anything
    // shorter is the trailing empty token, not an entry.
    if (token === undefined || token.length < 4) {
      continue;
    }
    const x = token[0] ?? " ";
    const y = token[1] ?? " ";
    let origin: string | null = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const from = tokens[index + 1];
      if (from !== undefined && from.length > 0) {
        origin = from;
        index += 1;
      }
    }
    entries.push({ x, y, path: token.slice(3), origin });
  }
  return entries;
}

/** The paths a status entry names — BOTH sides of a rename, because both
 *  belong to the commit that carries it. */
function entryPaths(entries: readonly PorcelainEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.origin === null ? [entry.path] : [entry.path, entry.origin],
  );
}

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

/** The two status columns git uses for a halted merge: the honest conflict
 *  set, read from the rebase before it is aborted. */
function isUnmerged(entry: PorcelainEntry): boolean {
  return (
    entry.x === "U" ||
    entry.y === "U" ||
    (entry.x === "A" && entry.y === "A") ||
    (entry.x === "D" && entry.y === "D")
  );
}

/**
 * git must NEVER ask this process a question. Nothing here has a terminal to
 * answer on, and every invocation runs under the repo lock — so a credential
 * prompt on an unreachable or auth-requiring remote does not fail, it BLOCKS,
 * holding the lock (and with it every vault write) until the call's timeout.
 *
 * `GIT_TERMINAL_PROMPT=0` covers git's own prompting. ssh does its own, which
 * only `BatchMode=yes` refuses — so an ssh remote gets it too, but only when
 * the environment carries no `GIT_SSH_COMMAND` of its own: a caller who set
 * one has chosen how ssh runs, and overriding it would break the setups that
 * exist to make these fetches work.
 */
function nonInteractiveGitEnv(env: NodeJS.ProcessEnv) {
  if (env.GIT_SSH_COMMAND === undefined) {
    return { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
  }
  return { GIT_TERMINAL_PROMPT: "0" };
}

export function runGit(
  cwd: string,
  gitArgs: readonly string[],
  options: RunGitOptions = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...gitArgs],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        timeout: options.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
        env: { ...process.env, ...nonInteractiveGitEnv(process.env), ...options.env },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitError(`git ${gitArgs[0] ?? ""} failed: ${error.message}`, stderr));
          return;
        }
        resolve({ stdout });
      },
    );
    // execFile hands the child a stdin PIPE nobody ever writes to. No command
    // this engine runs reads stdin, so closing it turns anything that asks
    // anyway into an immediate EOF rather than a wait on the timeout.
    child.stdin?.end();
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

/**
 * Whether a failed network invocation was the remote REFUSING the credential,
 * as opposed to being unreachable. Three spellings, because git's own varies:
 * an explicit 401/403 from the HTTP layer, "Authentication failed", and —
 * the one this engine's non-interactive env actually produces — "could not
 * read Username … terminal prompts disabled", which is git answering a 401
 * challenge with a prompt this process forbids.
 */
function isAuthRefusal(cause: unknown): boolean {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /authentication failed|returned error: 40[13]|could not read username/i.test(cause.stderr);
}

/** The remote itself is absent — the hosted repo before its first push
 *  (HTTP 404), or a path that names no repository. Distinct from
 *  unreachable/refused because only THIS class may fall through to the
 *  welcome seed: seeding beside a populated-but-unreachable remote plants a
 *  history the eventual first sync has to rebase through. */
function isMissingRemoteRepo(cause: unknown): boolean {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /repository .+ (not found|does not exist)|returned error: 404|does not appear to be a git repository/i.test(
    cause.stderr,
  );
}

/** The vault-side account marker: which account's hosted repo this checkout
 *  has synced with. ONE spelling, read and written by the engine below and
 *  by the clone path. */
const ACCOUNT_MARKER_KEY = "inteligir.account";

function identityEnv(author?: CommitAuthor) {
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
  /** The remote as of boot. A NEW vault dir clones from it instead of
   *  init+seed, which is what makes a second device join an existing vault
   *  rather than colliding with it. */
  remote?: VaultRemoteSpec | null;
  env?: Record<string, string>;
}

/**
 * Try to clone the configured remote into a root that does not exist yet,
 * and SAY which way it failed — the caller's seeding decision hangs on it:
 *
 * - "missing": the remote holds no repository (the hosted repo before its
 *   first push, an absent BYO path). Nothing existed to join, so the welcome
 *   seed is safe — the first push creates the remote.
 * - "failed": the remote may exist but could not answer (offline boot, a
 *   refused credential). Seeding HERE is the trap cubic's review named: a
 *   populated remote comes back later and the seed's history has to rebase
 *   through it. The vault boots EMPTY instead (one empty init commit, which
 *   `--empty=drop` discards on the eventual first sync), and a revoked
 *   credential surfaces as `unauthorized` rather than failing the boot —
 *   which would take down the very server the user re-pairs through.
 *
 * git cleans up its own partially-cloned directory on failure, so every
 * fall-through starts from the same absent root.
 */
async function tryCloneVault(
  args: EnsureVaultRepoArgs,
  remote: VaultRemoteSpec,
): Promise<"cloned" | "missing" | "failed"> {
  await mkdir(dirname(args.root), { recursive: true });
  try {
    await runGit(dirname(args.root), ["clone", "--", remote.url, args.root], {
      timeoutMs: NETWORK_GIT_TIMEOUT_MS,
      env: { ...args.env, ...remote.env },
    });
    return "cloned";
  } catch (error) {
    return isMissingRemoteRepo(error) ? "missing" : "failed";
  }
}

/**
 * Create the vault directory if absent — cloning the remote when one is
 * configured, else `git init` + seed — and always leave it with a born HEAD:
 * the sync loop rebases, and a rebase needs a commit to stand on.
 *
 * An EXISTING local vault beside a populated remote is deliberately not
 * merged here: the first sync pass rebases, and unrelated histories surface
 * as its typed `conflict` state rather than any silent resolution.
 */
export async function ensureVaultRepo(
  args: EnsureVaultRepoArgs,
): Promise<{ created: boolean; cloned: boolean }> {
  const created = !existsSync(args.root);
  const remote = args.remote ?? null;
  const outcome =
    created && remote !== null ? await tryCloneVault(args, remote) : ("missing" as const);
  const cloned = outcome === "cloned";
  await mkdir(args.root, { recursive: true });
  const runOptions = args.env ? { env: args.env } : {};
  if (!existsSync(join(args.root, ".git"))) {
    await runGit(args.root, ["init", "-b", "main"], runOptions);
  }
  await ensureLocalExclude(args.root);
  if (created && remote?.source === "paired" && remote.account !== undefined && cloned) {
    // The clone came from this account's repo; pin it so a later re-pair to
    // a DIFFERENT account refuses instead of pushing these notes into it.
    await runGit(args.root, ["config", ACCOUNT_MARKER_KEY, remote.account], runOptions);
  }
  // The welcome seed runs with NO remote, or when the HOSTED remote itself
  // answered "no repository" — which our Worker says only for a truly absent
  // repo (auth precedes it). An EXPLICIT remote's "not found" is ambiguous:
  // GitHub answers 404 for a private repo the credential cannot see, and
  // seeding beside it plants the unrelated history the eventual first sync
  // conflicts through. Those boot empty instead.
  const seedable = remote === null || (outcome === "missing" && remote.source === "paired");
  if (created && seedable && args.seed) {
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
  return { created, cloned };
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

  /** The ONE invocation. Pathspecs narrow it; the format never varies. */
  async function porcelain(paths: readonly string[] = []): Promise<PorcelainEntry[]> {
    const pathspec = paths.length === 0 ? [] : ["--", ...paths];
    const { stdout } = await run([
      "--no-optional-locks",
      "status",
      "--porcelain",
      "-z",
      ...pathspec,
    ]);
    return parsePorcelain(stdout);
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

  /**
   * A remote with nothing to fetch YET: the branch is missing ("couldn't find
   * remote ref"), or the repository itself is (the hosted remote answers 404
   * until the first push creates it). Both mean the same thing to the pass —
   * rebase onto nothing, and let the push below create what was missing. A
   * mistyped BYO remote also lands here and fails honestly at that push.
   */
  function isMissingRemoteRef(cause: unknown): boolean {
    return (
      cause instanceof GitError &&
      /couldn't find remote ref|repository .+ not found|returned error: 404/i.test(cause.stderr)
    );
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
      await withRepoLock(() => commitIfDirty()).catch(() => undefined);
    },
  };
}
