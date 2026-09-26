// the one spelling of an agent's commit: who wrote it and which turn it carries. the trailers are
// its identity, not the sha, which a rebase onto another device's push rewrites while it keeps
// the message byte for byte.

import type { CommitAuthor } from "./git-run";

export const AGENT_COMMIT_AUTHOR: CommitAuthor = {
  email: "agent@inteligir.local",
  name: "inteligir-agent",
};

const THREAD_KEY = "Thread";
const TURN_KEY = "Turn";
const UNDOES_TURN_KEY = "Undoes-Turn";

export const threadTrailer = (threadId: string): string => `${THREAD_KEY}: ${threadId}`;

export const agentCommitMessage = (threadId: string, turnId: string): string =>
  `agent: vault update\n\n${threadTrailer(threadId)}\n${TURN_KEY}: ${turnId}`;

export const undoCommitMessage = (threadId: string, turnId: string): string =>
  `vault: undo agent changes\n\n${threadTrailer(threadId)}\n${UNDOES_TURN_KEY}: ${turnId}`;

export type AgentCommitTrailers =
  | { kind: "turn"; threadId: string; turnId: string }
  | { kind: "undo"; threadId: string; undoesTurnId: string };

const TRAILER_LINE = /^(?<key>[A-Za-z-]+):[ \t]*(?<value>\S.*?)[ \t]*$/u;

// git's own trailer reading bends to the user's `trailer.*` config, so the block is read here:
// the message's last paragraph, holding one thread and exactly one of a turn or an undo.
export const parseAgentCommitTrailers = (message: string): AgentCommitTrailers | null => {
  const paragraphs = message.trimEnd().split(/\n[ \t]*\n/u);
  const block = paragraphs.at(-1) ?? "";
  const values = new Map<string, string[]>();
  for (const line of block.split("\n")) {
    const groups = TRAILER_LINE.exec(line)?.groups;
    if (groups?.key !== undefined && groups.value !== undefined) {
      values.set(groups.key, [...(values.get(groups.key) ?? []), groups.value]);
    }
  }
  const only = (key: string): string | null => {
    const found = values.get(key) ?? [];
    return found.length === 1 ? (found[0] ?? null) : null;
  };
  const threadId = only(THREAD_KEY);
  const turnId = only(TURN_KEY);
  const undoesTurnId = only(UNDOES_TURN_KEY);
  if (threadId === null) {
    return null;
  }
  if (turnId !== null && !values.has(UNDOES_TURN_KEY)) {
    return { kind: "turn", threadId, turnId };
  }
  if (undoesTurnId !== null && !values.has(TURN_KEY)) {
    return { kind: "undo", threadId, undoesTurnId };
  }
  return null;
};
