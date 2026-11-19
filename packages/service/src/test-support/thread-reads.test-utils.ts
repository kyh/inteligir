import { agentEventSchema } from "@repo/contract/library/agent-events";
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
) => {
  const read: Streamed[] = [];

  for await (const event of stream) {
    read.push({ event, id: getEventMeta(event)?.id });

    if (done(read)) {
      break;
    }
  }

  return read;
};

export const caughtUp = (read: readonly Streamed[]) =>
  read.some(({ event }) => event.kind === "caughtUp");

export const rowsOf = (read: readonly Streamed[]) =>
  read.flatMap(({ event }) => (event.kind === "event" ? [event.row] : []));

export const shownOf = (read: readonly Streamed[]) =>
  rowsOf(read).map(({ event }) => agentEventSchema.parse(event));
