// a turn's changes are read from the log by its trailers, never from a stored sha: a rebase onto
// another device's push rewrites the sha and keeps the message.

import type {
  TurnChanges,
  TurnChangesResponse,
  TurnChangeState,
} from "@repo/api/local/threads/threads-schema";
import type { DbConnection } from "@repo/db/connection";
import { getThread } from "@repo/db/threads";
import type { GitEngine } from "../vault/git-engine";
import type { TurnCommit } from "../vault/git-history";

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

interface ListTurnChangesArgs {
  db: DbConnection;
  git: GitEngine;
  threadId: string;
}

// null for a thread this device does not hold. a thread pulled from another device was created
// here when it arrived, so what that device committed before then is not listed.
export const listTurnChanges = async (
  args: ListTurnChangesArgs,
): Promise<TurnChangesResponse | null> => {
  const thread = getThread(args.db, args.threadId);
  if (thread === null) {
    return null;
  }
  const commits = await args.git.turnCommits(
    args.threadId,
    thread.createdAt - CLOCK_SKEW_MARGIN_MS,
  );
  return { turns: foldTurnCommits(commits) };
};
