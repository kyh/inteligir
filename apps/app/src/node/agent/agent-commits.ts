// Agent-attributed vault commits, shared by the codex manager and the
// scripted driver. The coordination with the vault's own auto-commit
// debounce: a turn takes a commit HOLD before its first write can land, so
// the watcher's debounce (and the sync loop's opening commit) cannot sweep
// agent writes into an engine-attributed commit mid-turn; at turn settle the
// finish path commits whatever is dirty under the agent identity — the
// author half only, so the committer still says which machine wrote it —
// and releases the hold. A user edit saved DURING an agent turn rides in
// that agent commit; accepted, single-machine local app.

import type { CommitAuthor, GitEngine } from "../vault/git";

const AGENT_COMMIT_AUTHOR: CommitAuthor = {
  name: "inteligir-agent",
  email: "agent@inteligir.local",
};

function agentCommitSubject(threadId: string): string {
  return `agent: vault update\n\nThread: ${threadId}`;
}

/**
 * Take the hold for one turn; the returned finish is idempotent, commits the
 * dirty tree as the agent, and releases — commit failure still releases.
 */
export function beginAgentTurnCommit(git: GitEngine, threadId: string): () => Promise<void> {
  const release = git.holdCommits();
  let finished = false;
  return async () => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      await git.commitNow(AGENT_COMMIT_AUTHOR, agentCommitSubject(threadId));
    } finally {
      release();
    }
  };
}
