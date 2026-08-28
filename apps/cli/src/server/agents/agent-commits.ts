// What a turn does with the files it wrote, shared by the ACP manager and
// the scripted driver — the turn's writes become the turn's OWN commit:
//
// - A turn takes a commit HOLD before its first write can land, so the
//   watcher's debounce and the sync loop cannot sweep agent writes into an
//   engine-attributed commit (or a rebase window) mid-turn. `ready` resolves
//   once any ALREADY-RUNNING sync/commit finishes — the caller awaits it
//   before letting the provider write, so the agent never writes during a
//   rebase's checkout window.
// - The turn records the paths its session reported writing (the fileChange
//   events name them). `finish` commits exactly that write set — author is
//   the agent, committer stays the engine identity, thread id in the
//   trailer — so a concurrent turn's held writes and a user's unrelated
//   edits stay uncommitted for their own settle/debounce commit.
//
// `finish` is idempotent and releases in a `finally`, so a turn that fails,
// times out or is abandoned cannot leave the hold behind.

import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { relativeUnder } from "../path-containment";
import type { CommitAuthor, GitEngine } from "../vault/git";

const AGENT_COMMIT_AUTHOR: CommitAuthor = {
  name: "inteligir-agent",
  email: "agent@inteligir.local",
};

function agentCommitSubject(threadId: string): string {
  return `agent: vault update\n\nThread: ${threadId}`;
}

export type VaultPathResolver = (reported: string) => string | null;

/**
 * Normalize a session-reported path (harnesses report absolute ones) into a
 * vault-relative pathspec; null for anything outside the vault — a path the
 * provider names must never widen the commit beyond the repo. The vault dir
 * is checked under BOTH its configured spelling and its realpath (macOS tmp
 * lives behind the /var → /private/var symlink, and harnesses report resolved
 * paths).
 */
export function createVaultPathResolver(vaultDir: string): VaultPathResolver {
  const configured = resolve(vaultDir);
  let real = configured;
  try {
    real = realpathSync(configured);
  } catch {
    // Keep the configured spelling; a missing vault fails later and louder.
  }
  const roots = real === configured ? [configured] : [configured, real];
  return (reported) => {
    if (!isAbsolute(reported)) {
      // Already vault-relative (the scripted driver's shape); still refuse
      // an escape.
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
}

export interface AgentTurnWrites {
  /** Resolves once no sync/commit is mid-flight on the repo. */
  ready: Promise<void>;
  /** Accumulate the turn's reported write set (vault-relative pathspecs). */
  recordPaths(paths: readonly string[]): void;
  /** Idempotent: settle the recorded write set, then release the hold. */
  finish(): Promise<void>;
}

export interface AgentTurnWritesArgs {
  git: GitEngine;
  threadId: string;
  turnId: string;
}

export function beginAgentTurnWrites(args: AgentTurnWritesArgs): AgentTurnWrites {
  const release = args.git.holdCommits();
  const writeSet = new Set<string>();
  let finished = false;

  // A no-op job behind the repo lock: it resolves only after any in-flight
  // sync pass (which holds that lock for its whole run) has finished, and the
  // hold above stops the NEXT one from starting.
  const settled = args.git.runExclusive(async () => undefined);

  return {
    ready: settled,
    recordPaths(paths) {
      for (const path of paths) {
        writeSet.add(path);
      }
    },
    async finish() {
      if (finished) {
        return;
      }
      finished = true;
      try {
        if (writeSet.size > 0) {
          await args.git.commitPaths(
            [...writeSet],
            AGENT_COMMIT_AUTHOR,
            agentCommitSubject(args.threadId),
          );
        }
      } finally {
        release();
      }
    },
  };
}
