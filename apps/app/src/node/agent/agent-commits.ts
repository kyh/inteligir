// What a turn does with the files it wrote, shared by the codex manager and
// the scripted driver. ONE seam with two modes, because both answer the same
// question — where does this turn's work end up — and the coordination with
// the vault's auto-commit debounce and sync loop is identical either way.
//
// - A turn takes a commit HOLD before its first write can land, so the
//   watcher's debounce and the sync loop cannot sweep agent writes into an
//   engine-attributed commit (or a rebase window) mid-turn. `ready` resolves
//   once any ALREADY-RUNNING sync/commit finishes — the caller awaits it
//   before letting the provider write, so codex never writes during a
//   rebase's checkout window.
// - The turn records the paths its session reported writing (the fileChange
//   events name them). `finish` settles them and releases the hold.
//
// DIRECT mode commits exactly that write set — author is the agent, committer
// stays the engine identity, thread id in the trailer. A concurrent turn's
// held writes and a user's unrelated edits stay uncommitted for their own
// settle/debounce commit.
//
// REVIEW mode (issue #560) commits nothing and captures instead. Three things
// make that work, and each is a consequence of the provider owning the
// filesystem rather than a choice:
//
//   1. THE BASE COMES FROM GIT, not from disk. A write is REPORTED after it
//      lands, so by the time this module hears about a path the pre-turn
//      bytes are gone from the working tree. So `ready` flushes the dirty
//      tree into an ordinary engine commit and pins HEAD — the hold then
//      keeps HEAD still for the whole turn, which makes that revision the
//      turn's base by construction. The flush is not a side effect worth
//      hiding: it is the auto-commit the debounce would have made seconds
//      later, and it puts the user's own edits safely behind them before an
//      agent touches anything.
//   2. THE CAPTURE IS AT SETTLE, not per event. Reverting a file the instant
//      its write is reported would pull the ground out from under a
//      multi-step edit — the agent reads back what it just wrote — so the
//      turn works in the real tree and its writes are lifted out at the end.
//      The residual is stated rather than papered over: for the duration of a
//      review-mode turn the agent's bytes ARE on disk, and an open editor
//      will merge them the way it does any external change. Removing that
//      window needs a per-turn worktree the provider is pointed at, which is
//      a different change to a different seam.
//   3. THE REVERT IS GUARDED. Restoring the base goes through the vault
//      service's compare-and-swap (`writeIfUnchanged` / `removeIfUnchanged`),
//      so a user's save that landed between the capture's read and its write
//      keeps its bytes instead of losing them to a rollback of somebody
//      else's work.
//
// Either way `finish` is idempotent and releases in a `finally`, so a turn
// that fails, times out or is abandoned cannot leave the hold behind.

import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
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

/** What review mode does with the turn's write set. Implemented by
 *  `../proposals/turn-proposals.ts`, which owns the store and the vault. */
export type CaptureTurnProposals = (args: {
  threadId: string;
  turnId: string;
  /** The revision the turn started from — where the base bytes are read. */
  baseRev: string;
  paths: readonly string[];
}) => Promise<void>;

export interface AgentTurnWrites {
  /** Resolves once no sync/commit is mid-flight on the repo — and, in review
   *  mode, once the base revision is pinned. */
  ready: Promise<void>;
  /** Accumulate the turn's reported write set (vault-relative pathspecs). */
  recordPaths(paths: readonly string[]): void;
  /** Idempotent: settle the recorded write set, then release the hold. */
  finish(): Promise<void>;
}

export type AgentTurnWritesArgs =
  | { mode: Extract<AgentWriteMode, "direct">; git: GitEngine; threadId: string; turnId: string }
  | {
      mode: Extract<AgentWriteMode, "propose">;
      git: GitEngine;
      threadId: string;
      turnId: string;
      capture: CaptureTurnProposals;
    };

export function beginAgentTurnWrites(args: AgentTurnWritesArgs): AgentTurnWrites {
  const release = args.git.holdCommits();
  const writeSet = new Set<string>();
  let finished = false;

  // A no-op job behind the repo lock: it resolves only after any in-flight
  // sync pass (which holds that lock for its whole run) has finished, and the
  // hold above stops the NEXT one from starting.
  const settled = args.git.runExclusive(async () => undefined);

  if (args.mode === "direct") {
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

  const { capture, git, threadId, turnId } = args;
  let baseRev: string | null = null;
  const ready = (async () => {
    await settled;
    // The flush the base depends on. Allowed under the hold — the hold defers
    // the DEBOUNCE and blocks a sync from starting; an explicit commit is
    // always the caller's own decision.
    await git.commitNow();
    baseRev = await git.headRevision();
  })();

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
        // A turn that failed before `ready` settled has no base to measure
        // against; its writes (if any) stay where they are rather than being
        // reverted against a revision nobody pinned.
        await ready.catch(() => undefined);
        if (baseRev !== null && writeSet.size > 0) {
          await capture({ threadId, turnId, baseRev, paths: [...writeSet] });
        }
      } finally {
        release();
      }
    },
  };
}
