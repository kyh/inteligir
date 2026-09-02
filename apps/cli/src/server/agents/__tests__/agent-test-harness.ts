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
export const PROVIDER_WAIT = { timeout: 5_000, interval: 25 };

export function fakeSessionFacts(overrides: Partial<AgentSessionFacts> = {}): AgentSessionFacts {
  return {
    dataDir: "/instances/test/data",
    cliBinDir: null,
    skillsDir: null,
    connectedDirs: [],
    ...overrides,
  };
}

export async function createThread(
  client: ThreadClient,
  input: CreateThreadRequest = {},
): Promise<string> {
  const { thread } = await client.threads.create(input);
  return thread.id;
}

export async function sendMessage(
  client: ThreadClient,
  threadId: string,
  text: string,
): Promise<string> {
  const outcome = await client.threads.send({ threadId, text });
  if (outcome.kind !== "started") {
    throw new Error(`expected the send to start a turn, got ${outcome.kind}`);
  }
  return outcome.turnId;
}

export async function getThreadDetail(
  client: ThreadClient,
  threadId: string,
): Promise<{ status: string; pendingInteractions: PendingInteraction[] }> {
  const detail = await client.threads.get({ threadId });
  return { status: detail.thread.status, pendingInteractions: detail.pendingInteractions };
}

export async function awaitThreadStatus(
  client: ThreadClient,
  threadId: string,
  wanted: string,
): Promise<void> {
  await vi.waitFor(
    async () => expect((await getThreadDetail(client, threadId)).status).toBe(wanted),
    PROVIDER_WAIT,
  );
}

export async function awaitPendingInteraction(
  client: ThreadClient,
  threadId: string,
): Promise<PendingInteraction> {
  return await vi.waitFor(async () => {
    const [interaction] = (await getThreadDetail(client, threadId)).pendingInteractions;
    if (interaction === undefined) throw new Error("no pending interaction yet");
    return interaction;
  }, PROVIDER_WAIT);
}

export async function fetchTimelineRows(
  client: ThreadClient,
  threadId: string,
): Promise<TimelineRow[]> {
  const response = await client.threads.timeline({ threadId });
  if (response.kind !== "full") {
    throw new Error("expected a full timeline");
  }
  return response.timeline.rows;
}

export function flattenTimelineRows(rows: TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => (row.kind === "turn" ? [row, ...row.children] : [row]));
}
