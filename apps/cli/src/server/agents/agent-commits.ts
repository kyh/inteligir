// a turn holds commits before its first write, so the debounce and the sync loop cannot sweep agent writes into
// an engine-attributed commit mid-turn; callers await `ready` before letting the provider write, so nothing lands
// inside a rebase's checkout window.

import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { relativeUnder } from "../path-containment";
import type { GitEngine } from "../vault/git-engine";
import type { CommitAuthor } from "../vault/git-run";

const AGENT_COMMIT_AUTHOR: CommitAuthor = {
  name: "inteligir-agent",
  email: "agent@inteligir.local",
};

function agentCommitSubject(threadId: string): string {
  return `agent: vault update\n\nThread: ${threadId}`;
}

export type VaultPathResolver = (reported: string) => string | null;

// checked under both the configured spelling and its realpath: macOS tmp lives behind /var → /private/var
// and harnesses report resolved paths.
export function createVaultPathResolver(vaultDir: string): VaultPathResolver {
  const configured = resolve(vaultDir);
  let real = configured;
  try {
    real = realpathSync(configured);
  } catch {
    // keep the configured spelling; a missing vault fails later and louder.
  }
  const roots = real === configured ? [configured] : [configured, real];
  return (reported) => {
    if (!isAbsolute(reported)) {
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
}

export interface AgentTurnWrites {
  ready: Promise<void>;
  recordPaths(paths: readonly string[]): void;
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

  // a no-op behind the repo lock resolves only after any in-flight sync pass (which holds it for its whole run);
  // the hold above stops the next one from starting.
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
