// a turn's changes are read from the log by its trailers, never from a stored sha: a rebase onto
// another device's push rewrites the sha and keeps the message.

import type {
  TurnChanges,
  TurnChangesResponse,
  TurnChangeState,
  UndoKeptPath,
  UndoKeptReason,
  UndoTurnResponse,
} from "@repo/api/local/threads/threads-schema";
import type { DbConnection } from "@repo/db/connection";
import { getThread } from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { DbNotifier } from "@repo/domain/notifier";
import { isThreadRunning } from "@repo/domain/thread-status";
import {
  isCommentsStorePath,
  isLegacyCommentsSidecarPath,
} from "@repo/notes/comments/sidecar-schema";
import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { revertEdit, turnEditOf } from "@repo/notes/text/revert-edit";
import type { RevertVerdict } from "@repo/notes/text/revert-edit";
import type { GitEngine } from "../vault/git-engine";
import type { TurnCommit } from "../vault/git-history";
import { ENGINE_IDENTITY } from "../vault/git-run";
import { undoCommitMessage } from "../vault/turn-trailers";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";

// the walk reads committer dates, which are the committing device's clock, and git stops a line of
// history at the first commit older than the bound; a day costs a day's commits and outlasts any
// clock a device keeps in sync.
const CLOCK_SKEW_MARGIN_MS = 24 * 60 * 60 * 1000;

export type ListTurnChanges = (threadId: string) => Promise<TurnChangesResponse | null>;

interface FoldedTurn {
  paths: Set<string>;
  state: TurnChangeState;
}

// oldest first, since the log is read oldest first and a Map keeps its first insertion.
const foldTurnCommits = (commits: readonly TurnCommit[]): TurnChanges[] => {
  const turns = new Map<string, FoldedTurn>();
  for (const commit of commits) {
    switch (commit.trailers.kind) {
      case "turn": {
        const turn = turns.get(commit.trailers.turnId) ?? { paths: new Set(), state: "applied" };
        for (const change of commit.changes) {
          turn.paths.add(change.path);
        }
        turns.set(commit.trailers.turnId, turn);
        break;
      }
      case "undo": {
        const undone = turns.get(commit.trailers.undoesTurnId);
        if (undone !== undefined) {
          undone.state = "undone";
        }
        break;
      }
      // no default
    }
  }
  return [...turns].map(([turnId, turn]) => ({
    paths: [...turn.paths],
    state: turn.state,
    turnId,
  }));
};

// a thread pulled from another device was created here when it arrived, so what that device
// committed before then is not read.
const readThreadTurnCommits = async (git: GitEngine, thread: ThreadRow): Promise<TurnCommit[]> =>
  await git.turnCommits(thread.id, thread.createdAt - CLOCK_SKEW_MARGIN_MS);

interface ListTurnChangesArgs {
  db: DbConnection;
  git: GitEngine;
  threadId: string;
}

// null for a thread this device does not hold.
export const listTurnChanges = async (
  args: ListTurnChangesArgs,
): Promise<TurnChangesResponse | null> => {
  const thread = getThread(args.db, args.threadId);
  if (thread === null) {
    return null;
  }
  return { turns: foldTurnCommits(await readThreadTurnCommits(args.git, thread)) };
};

export type UndoTurnOutcome =
  | { kind: "undone"; changes: UndoTurnResponse }
  | { kind: "not-found"; message: string }
  | { kind: "conflict"; message: string };

export type UndoTurnChanges = (threadId: string, turnId: string) => Promise<UndoTurnOutcome>;

// the trees a path is read at: the parent of the turn's first commit to touch it, and the turn's
// last commit to touch it.
interface PathSpan {
  path: string;
  before: string;
  after: string;
}

const turnSpans = (commits: readonly TurnCommit[], turnId: string): PathSpan[] => {
  const spans = new Map<string, PathSpan>();
  for (const commit of commits) {
    if (commit.trailers.kind !== "turn" || commit.trailers.turnId !== turnId) {
      continue;
    }
    for (const { path } of commit.changes) {
      spans.set(path, {
        after: commit.sha,
        before: spans.get(path)?.before ?? commit.parent,
        path,
      });
    }
  }
  return [...spans.values()];
};

// a comment store is json, which a line merge can leave unparseable, so its entries are not
// taken back here.
const isCommentStore = (path: string): boolean =>
  isCommentsStorePath(path) || isLegacyCommentsSidecarPath(path);

type ReadSide = { readable: true; text: string | null } | { readable: false };

// the vault and git hand bytes over decoded as utf-8, so bytes that are not text arrive holding a
// replacement character or a nul, and writing them back would corrupt the file.
const isText = (text: string): boolean => !text.includes("\0") && !text.includes("\uFFFD");

const readSide = async (read: () => Promise<string>): Promise<ReadSide> => {
  try {
    const text = await read();
    return isText(text) ? { readable: true, text } : { readable: false };
  } catch (error) {
    if (error instanceof VaultServiceError && error.code === "not_found") {
      return { readable: true, text: null };
    }
    // over the read cap, or a symlink planted at the path since.
    if (
      (error instanceof VaultServiceError && error.code === "too_large") ||
      error instanceof VaultPathError
    ) {
      return { readable: false };
    }
    throw error;
  }
};

type RevertService = Pick<
  VaultService,
  "read" | "removeIfUnchanged" | "writeGuarded" | "writeIfUnchanged"
>;

type Landed =
  | { kind: "reverted" }
  | { kind: "kept"; reason: UndoKeptReason }
  // the path is already where the undo would take it: the note the turn made is gone
  | { kind: "already-there" };

// every write is the vault's own compare-and-swap, so a path that changed after its verdict was
// read is kept and named, never overwritten.
const landVerdict = async (
  service: RevertService,
  path: string,
  verdict: Exclude<RevertVerdict, { kind: "unchanged" } | { kind: "keep" }>,
): Promise<Landed> => {
  switch (verdict.kind) {
    case "write": {
      const written = await service.writeIfUnchanged(path, verdict.expected, verdict.content);
      if (written.applied) {
        return { kind: "reverted" };
      }
      return {
        kind: "kept",
        reason: written.reason === "changed" ? "edited-since" : "deleted-since",
      };
    }
    case "remove": {
      const removed = await service.removeIfUnchanged(path, verdict.expected);
      if (removed.applied) {
        return { kind: "reverted" };
      }
      return removed.reason === "changed"
        ? { kind: "kept", reason: "edited-since" }
        : { kind: "already-there" };
    }
    case "recreate": {
      try {
        const created = await service.writeGuarded(path, verdict.content, { kind: "absent" });
        return created.applied ? { kind: "reverted" } : { kind: "kept", reason: "recreated-since" };
      } catch (error) {
        // a folder now stands at the path, or a file where one of its folders must be.
        if (error instanceof VaultServiceError && error.code === "conflict") {
          return { kind: "kept", reason: "recreated-since" };
        }
        throw error;
      }
    }
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
};

interface UndoTurnArgs {
  db: DbConnection;
  git: GitEngine;
  service: RevertService;
  notifier: DbNotifier;
  threadId: string;
  turnId: string;
}

// through the vault's own writes, so the re-index, the bus and an open buffer hear the undo like
// any other edit, which git revert would bypass; and three-way, since a byte restore to the
// turn's parent would drop every edit made since. nothing hands the writes to a running turn, so
// an agent undoing an earlier turn from inside a later one does not commit the undo as its own.
export const undoTurnChanges = async (args: UndoTurnArgs): Promise<UndoTurnOutcome> => {
  const { git, service, threadId, turnId } = args;
  const thread = getThread(args.db, threadId);
  if (thread === null) {
    return { kind: "not-found", message: "Thread not found" };
  }
  if (thread.activeTurnId === turnId && isThreadRunning(thread.status)) {
    return { kind: "conflict", message: `Turn ${turnId} is still running` };
  }
  // held from the first read, so neither the auto-commit nor a sync pass sweeps the undo's
  // writes into a commit that does not name the turn it undoes.
  const hold = git.holdCommits();
  try {
    // a turn settles before its commit lands, and that commit is already queued on the repo lock.
    await git.runExclusive(async () => {
      await Promise.resolve();
    });
    const commits = await readThreadTurnCommits(git, thread);
    const turn = foldTurnCommits(commits).find((folded) => folded.turnId === turnId);
    if (turn === undefined) {
      return { kind: "not-found", message: `No change of turn ${turnId} is recorded here` };
    }
    if (turn.state === "undone") {
      return { kind: "conflict", message: `Turn ${turnId} was already undone` };
    }

    const busy = new Set(git.claimedPaths());
    const reverted: string[] = [];
    const kept: UndoKeptPath[] = [];
    for (const span of turnSpans(commits, turnId)) {
      const { path } = span;
      if (isCommentStore(path)) {
        continue;
      }
      if (busy.has(path)) {
        kept.push({ path, reason: "busy" });
        continue;
      }
      const [before, after, current] = await Promise.all([
        readSide(async () => await git.revision(path, span.before)),
        readSide(async () => await git.revision(path, span.after)),
        readSide(async () => {
          const { content } = await service.read(path);
          return content;
        }),
      ]);
      if (!before.readable || !after.readable || !current.readable) {
        kept.push({ path, reason: "unreadable" });
        continue;
      }
      const edit = turnEditOf(before.text, after.text);
      if (edit === null) {
        continue;
      }
      const verdict = revertEdit({ ...edit, current: current.text });
      if (verdict.kind === "unchanged") {
        continue;
      }
      if (verdict.kind === "keep") {
        kept.push({ path, reason: verdict.reason });
        continue;
      }
      hold.claim([path]);
      const landed = await landVerdict(service, path, verdict);
      if (landed.kind === "reverted") {
        reverted.push(path);
      } else if (landed.kind === "kept") {
        kept.push({ path, reason: landed.reason });
      }
    }

    const committed = await git.commitPaths(
      reverted,
      ENGINE_IDENTITY,
      undoCommitMessage(threadId, turnId),
    );
    if (committed !== null) {
      args.notifier.notifyThread(threadId, ["changes-committed"]);
    }
    return { changes: { kept, reverted }, kind: "undone" };
  } finally {
    hold.release();
  }
};
