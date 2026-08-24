// Thread-domain helpers for the driver e2e suites over the shared
// `bootTestApp` (../../__tests__/boot-app): create/send/poll/read against the
// typed client, exactly as production serves it.

import type {
  CreateThreadRequest,
  PendingInteraction,
} from "@repo/api/local/threads/threads-schema";
import type { TimelineRow } from "@repo/api/local/thread-timeline";
import type { BootedTestApp } from "../../__tests__/boot-app";

type ThreadClient = BootedTestApp["client"];

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
  const outcome = await client.threads.send({ threadId, text, mode: "steer-if-active" });
  // A steer or a queue answers with someone else's turn id — or none at all —
  // so the caller's "this send started that turn" claim is checked here.
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

/** Work rows nest as children of their turn row; flatten for assertions. */
export function flattenTimelineRows(rows: TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => (row.kind === "turn" ? [row, ...row.children] : [row]));
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
