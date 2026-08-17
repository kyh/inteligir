// Agent-attributed vault commits, shared by the codex manager and the
// scripted driver. The coordination with the vault's own auto-commit
// debounce and sync loop:
//
// - A turn takes a commit HOLD before its first write can land, so the
//   watcher's debounce and the sync loop cannot sweep agent writes into an
//   engine-attributed commit (or a rebase window) mid-turn. `ready` resolves
//   once any ALREADY-RUNNING sync/commit finishes — the caller awaits it
//   before letting the provider write, so codex never writes during a
//   rebase's checkout window.
// - The turn records the paths its session reported writing (the fileChange
//   events name them); `finish` commits exactly that write set — author is the
//   agent, committer stays the engine identity, thread id in the trailer —
//   and releases the hold. A concurrent turn's held writes and a user's
//   unrelated edits stay uncommitted for their own settle/debounce commit.

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
 * Normalize a session-reported path (codex reports absolute ones) into a
 * vault-relative pathspec; null for anything outside the vault — a path the
 * provider names must never widen the commit beyond the repo. The vault dir
 * is checked under BOTH its configured spelling and its realpath (macOS tmp
 * lives behind the /var → /private/var symlink, and codex reports resolved
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

export interface AgentTurnCommit {
  /** Resolves once no sync/commit is mid-flight on the repo. */
  ready: Promise<void>;
  /** Accumulate the turn's reported write set (vault-relative pathspecs). */
  recordPaths(paths: readonly string[]): void;
  /** Idempotent: commit the recorded write set as the agent, then release. */
  finish(): Promise<void>;
}

export function beginAgentTurnCommit(git: GitEngine, threadId: string): AgentTurnCommit {
  const release = git.holdCommits();
  // A no-op job behind the repo lock: it resolves only after any in-flight
  // sync pass (which holds that lock for its whole run) has finished, and the
  // hold above stops the NEXT one from starting.
  const ready = git.runExclusive(async () => undefined);
  const writeSet = new Set<string>();
  let finished = false;
  return {
    ready,
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
          await git.commitPaths([...writeSet], AGENT_COMMIT_AUTHOR, agentCommitSubject(threadId));
        }
      } finally {
        release();
      }
    },
  };
}
