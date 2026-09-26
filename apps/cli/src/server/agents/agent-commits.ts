// a turn holds commits before its first write, so the debounce and the sync loop cannot sweep agent writes into
// an engine-attributed commit mid-turn; callers await `ready` before letting the provider write, so nothing lands
// inside a rebase's checkout window. `ready` is also the turn's checkpoint: whatever the user had not yet
// committed lands first, as the engine, so an undo that reverts to the turn commit's parent keeps it.

import { realpathSync } from "node:fs";
import nodePath from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import { messageOf } from "../error-message";
import { relativeUnder } from "../path-containment";
import type { GitEngine } from "../vault/git-engine";
import { AGENT_COMMIT_AUTHOR, agentCommitMessage } from "../vault/turn-trailers";

export type VaultPathResolver = (reported: string) => string | null;

// checked under both the configured spelling and its realpath: macOS tmp lives behind /var → /private/var
// and harnesses report resolved paths.
export const createVaultPathResolver = (vaultDir: string): VaultPathResolver => {
  const configured = nodePath.resolve(vaultDir);
  let real = configured;
  try {
    real = realpathSync(configured);
  } catch {
    // keep the configured spelling; a missing vault fails later and louder.
  }
  const roots = real === configured ? [configured] : [configured, real];
  return function resolveVaultPath(reported) {
    if (!nodePath.isAbsolute(reported)) {
      // already vault-relative (the scripted driver's shape); still refuse an escape.
      return relativeUnder(".", reported);
    }
    for (const root of roots) {
      const rel = relativeUnder(root, reported);
      if (rel !== null) {
        return rel;
      }
    }
    return null;
  };
};

export interface AgentTurnWrites {
  ready: Promise<void>;
  recordPaths: (paths: readonly string[]) => void;
  finish: () => Promise<void>;
}

export interface AgentTurnWritesArgs {
  git: GitEngine;
  notifier: DbNotifier;
  threadId: string;
  turnId: string;
  onError?: (message: string) => void;
}

export const beginAgentTurnWrites = (args: AgentTurnWritesArgs): AgentTurnWrites => {
  const hold = args.git.holdCommits();
  const writeSet = new Set<string>();
  let finished = false;

  // behind the repo lock, so it also waits out a locked step of an in-flight pass, its rebase
  // included; a pass still fetching meets the hold above before its rebase and ends there, and the
  // hold stops the next one from starting. a failed checkpoint costs the turn's commit a parent
  // holding the user's latest edits, never the turn itself.
  const ready = (async () => {
    try {
      await args.git.checkpointUnclaimed();
    } catch (error) {
      args.onError?.(`the checkpoint before turn ${args.turnId} failed: ${messageOf(error)}`);
    }
  })();

  return {
    async finish() {
      if (finished) {
        return;
      }
      finished = true;
      try {
        if (writeSet.size > 0) {
          const committed = await args.git.commitPaths(
            [...writeSet],
            AGENT_COMMIT_AUTHOR,
            agentCommitMessage(args.threadId, args.turnId),
          );
          // the turn settles before its commit lands, so a window reading the turn's changes
          // on its settle would read the log without them.
          if (committed !== null) {
            args.notifier.notifyThread(args.threadId, ["changes-committed"]);
          }
        }
      } finally {
        hold.release();
      }
    },
    ready,
    recordPaths(paths) {
      hold.claim(paths);
      for (const path of paths) {
        writeSet.add(path);
      }
    },
  };
};
