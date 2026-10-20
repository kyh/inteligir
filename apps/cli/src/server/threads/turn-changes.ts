// a turn's changes are read from the log by its trailers, never from a stored sha: a rebase onto
// another device's push rewrites the sha and keeps the message.

import type {
  TurnChanges,
  TurnChangesResponse,
  TurnChangeState,
} from "@repo/contract/local/threads/threads-schema";
import type { DbConnection } from "@repo/db/connection";
import { turnItemPaths } from "@repo/notes/items/turn-items";
import type { TurnPathChange } from "@repo/notes/items/turn-items";
import { getThread } from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { GitEngine } from "../vault/git-engine";
import type { TurnCommit } from "../vault/git-history";

// the walk reads committer dates, which are the committing device's clock, and git stops a line of
// history at the first commit older than the bound; a day costs a day's commits and outlasts any
// clock a device keeps in sync.
const CLOCK_SKEW_MARGIN_MS = 24 * 60 * 60 * 1000;

interface FoldedTurn {
  // each path with the first and the last way the turn's commits changed it
  paths: Map<string, { first: string; last: string }>;
  state: TurnChangeState;
}

// how a path ended up across the turn: made, removed or edited; null for one made and removed
// again within it, which changed no item
const netChange = (span: { first: string; last: string }): TurnPathChange["change"] | null => {
  const before = span.first !== "A";
  const after = span.last !== "D";
  if (before && after) {
    return "modified";
  }
  if (before) {
    return "deleted";
  }
  return after ? "added" : null;
};

// oldest first, since the log is read oldest first and a Map keeps its first insertion.
export const foldTurnCommits = (commits: readonly TurnCommit[]): TurnChanges[] => {
  const turns = new Map<string, FoldedTurn>();
  for (const commit of commits) {
    switch (commit.trailers.kind) {
      case "turn": {
        const turn = turns.get(commit.trailers.turnId) ?? { paths: new Map(), state: "applied" };
        for (const change of commit.changes) {
          const first = turn.paths.get(change.path)?.first ?? change.status;
          turn.paths.set(change.path, { first, last: change.status });
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
    items: turnItemPaths(
      [...turn.paths].flatMap(([path, span]) => {
        const change = netChange(span);
        return change === null ? [] : [{ change, path }];
      }),
    ),
    paths: [...turn.paths.keys()],
    state: turn.state,
    turnId,
  }));
};

// a thread pulled from another device was created here when it arrived, so what that device
// committed before then is not read.
export const readThreadTurnCommits = async (
  git: GitEngine,
  thread: ThreadRow,
): Promise<TurnCommit[]> =>
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
