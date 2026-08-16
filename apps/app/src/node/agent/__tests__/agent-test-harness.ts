// Thread-domain helpers for the driver e2e suites over the shared
// `bootTestApp` (../../__tests__/boot-app): create/send/poll/read against the
// typed client, exactly as production serves it.

import type { ApiClient } from "@repo/server-contract/client";
import {
  threadSchema,
  pendingInteractionSchema,
  timelineResponseSchema,
  type PendingInteraction,
  type TimelineResponse,
} from "@repo/server-contract/threads";
import type { TimelineRow } from "@repo/server-contract/thread-timeline";
import { expect } from "vitest";
import { z } from "zod";

const threadEnvelopeSchema = z.object({ thread: threadSchema });
const threadDetailSchema = z.object({
  thread: threadSchema,
  pendingInteractions: z.array(pendingInteractionSchema),
});
const startedResponseSchema = z.object({ kind: z.literal("started"), turnId: z.string().min(1) });

export async function createThread(client: ApiClient): Promise<string> {
  const response = await client.threads.create.$post({ json: {} });
  expect(response.status).toBe(201);
  return threadEnvelopeSchema.parse(await response.json()).thread.id;
}

export async function sendMessage(
  client: ApiClient,
  threadId: string,
  text: string,
): Promise<string> {
  const response = await client.threads.send.$post({
    json: { threadId, text, mode: "steer-if-active" },
  });
  expect(response.status).toBe(200);
  return startedResponseSchema.parse(await response.json()).turnId;
}

export async function getThreadDetail(
  client: ApiClient,
  threadId: string,
): Promise<{ status: string; pendingInteractions: PendingInteraction[] }> {
  const response = await client.threads.get.$get({ query: { threadId } });
  expect(response.status).toBe(200);
  const detail = threadDetailSchema.parse(await response.json());
  return { status: detail.thread.status, pendingInteractions: detail.pendingInteractions };
}

export async function fetchTimelineRows(
  client: ApiClient,
  threadId: string,
): Promise<TimelineRow[]> {
  const response = await client.threads.timeline.$get({ query: { threadId } });
  expect(response.status).toBe(200);
  const parsed: TimelineResponse = timelineResponseSchema.parse(await response.json());
  if (parsed.kind !== "full") {
    throw new Error("expected a full timeline");
  }
  return parsed.timeline.rows;
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
