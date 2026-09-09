import type {
  CreateThreadRequest,
  PendingInteraction,
} from "@repo/api/local/threads/threads-schema";
import type { TimelineRow } from "@repo/api/local/thread-timeline";
import { expect, vi } from "vitest";
import type { BootedTestApp } from "../../__tests__/boot-app";
import type { AgentSessionFacts } from "../agent-shell-env";

type ThreadClient = BootedTestApp["client"];

// vi.waitFor's one-second default is sized for in-process state; an adapter child answers in seconds.
export const PROVIDER_WAIT = { interval: 25, timeout: 5000 };

export const fakeSessionFacts = (
  overrides: Partial<AgentSessionFacts> = {},
): AgentSessionFacts => ({
  cliBinDir: null,
  connectedDirs: [],
  dataDir: "/instances/test/data",
  skillsDir: null,
  ...overrides,
});

export const createThread = async (
  client: ThreadClient,
  input: CreateThreadRequest = {},
): Promise<string> => {
  const { thread } = await client.threads.create(input);
  return thread.id;
};

export const sendMessage = async (
  client: ThreadClient,
  threadId: string,
  text: string,
): Promise<string> => {
  const outcome = await client.threads.send({ text, threadId });
  if (outcome.kind !== "started") {
    throw new Error(`expected the send to start a turn, got ${outcome.kind}`);
  }
  return outcome.turnId;
};

export const getThreadDetail = async (
  client: ThreadClient,
  threadId: string,
): Promise<{ status: string; pendingInteractions: PendingInteraction[] }> => {
  const detail = await client.threads.get({ threadId });
  return { pendingInteractions: detail.pendingInteractions, status: detail.thread.status };
};

export const awaitThreadStatus = async (
  client: ThreadClient,
  threadId: string,
  wanted: string,
): Promise<void> => {
  await vi.waitFor(async () => {
    const detail = await getThreadDetail(client, threadId);
    expect(detail.status).toBe(wanted);
  }, PROVIDER_WAIT);
};

export const awaitPendingInteraction = async (
  client: ThreadClient,
  threadId: string,
): Promise<PendingInteraction> =>
  await vi.waitFor(async () => {
    const detail = await getThreadDetail(client, threadId);
    const [interaction] = detail.pendingInteractions;
    if (interaction === undefined) {
      throw new Error("no pending interaction yet");
    }
    return interaction;
  }, PROVIDER_WAIT);

export const fetchTimelineRows = async (
  client: ThreadClient,
  threadId: string,
): Promise<TimelineRow[]> => {
  const response = await client.threads.timeline({ threadId });
  if (response.kind !== "full") {
    throw new Error("expected a full timeline");
  }
  return response.timeline.rows;
};

export const flattenTimelineRows = (rows: TimelineRow[]): TimelineRow[] =>
  rows.flatMap((row) => (row.kind === "turn" ? [row, ...row.children] : [row]));
