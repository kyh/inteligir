import { expect } from "./assert";
import type { InstanceApi } from "./instance";
import { pollUntil } from "./poll";

const TURN_DEADLINE_MS = 30_000;

// an error is a settle too, so it fails at once rather than waiting out the deadline.
export const untilThreadIdle = async (api: InstanceApi, threadId: string): Promise<void> => {
  await pollUntil(
    async () => {
      const { thread } = await api.threads.get({ threadId });
      return thread;
    },
    (current) => {
      expect(current.status !== "error", "the turn settled in error");
      return current.status === "idle";
    },
    {
      deadlineMs: TURN_DEADLINE_MS,
      describe: (current) => `turn still "${current.status}" after ${TURN_DEADLINE_MS}ms`,
    },
  );
};

// the scripted driver writes `# Agent note\n\n<text>\n` to Agent/<thread>.md on every turn.
export const agentNote = (text: string): string => `# Agent note\n\n${text}\n`;

export const runTurn = async (
  api: InstanceApi,
  threadId: string,
  text: string,
): Promise<string> => {
  const outcome = await api.threads.send({ text, threadId });
  expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);
  await untilThreadIdle(api, threadId);
  return outcome.turnId;
};
