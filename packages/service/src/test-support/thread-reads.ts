// A thread followed as a device follows it: each streamed event beside the id a reconnect sends
// back, read until the suite has what it waits for, then left as a device leaving leaves.

import { agentEventSchema } from "@repo/contract/library/agent-events";
import type { AgentEvent } from "@repo/contract/library/agent-events";
import type { threadStreamEventSchema } from "@repo/contract/library/library-wire";
import { getEventMeta } from "@orpc/server";
import type { z } from "zod";

type ThreadStreamEvent = z.infer<typeof threadStreamEventSchema>;

export interface Streamed {
  readonly event: ThreadStreamEvent;
  readonly id: string | undefined;
}

export const readStream = async (
  stream: AsyncIterable<ThreadStreamEvent>,
  done: (read: readonly Streamed[]) => boolean,
): Promise<Streamed[]> => {
  const read: Streamed[] = [];
  for await (const event of stream) {
    read.push({ event, id: getEventMeta(event)?.id });
    if (done(read)) {
      break;
    }
  }
  return read;
};

export const caughtUp = (read: readonly Streamed[]): boolean =>
  read.some(({ event }) => event.kind === "caughtUp");

// the rows read, in order
export const rowsOf = (read: readonly Streamed[]) =>
  read.flatMap(({ event }) => (event.kind === "event" ? [event.row] : []));

// each row's event, as the contract's union reads it
export const shownOf = (read: readonly Streamed[]): AgentEvent[] =>
  rowsOf(read).map(({ event }) => agentEventSchema.parse(event));
