import { createORPCClient, DynamicLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { V1Client } from "@repo/contract/rpc/v1-contract";

import { threadQueries } from "./thread-queries";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";

const asked = z.object({ cursor: z.number().optional() });

const noEvents = async function* noEvents() {};

// a device over a cloud that answers the threads a page from each cursor, and a thread's events
// from `events`, by the last id the device held
const device = ({
  events = noEvents,
  threads = () => ({}),
}: {
  readonly events?: (lastEventId: string | undefined) => AsyncIterable<object>;
  readonly threads?: (input: z.infer<typeof asked>) => object;
}) => {
  const resumedAfter: (string | undefined)[] = [];
  const client = createORPCClient<V1Client>(
    new DynamicLink((options, path, input) => ({
      call: async () => {
        if (path.join(".") !== "library.agent.events") {
          return await Promise.resolve(threads(asked.parse(input)));
        }
        resumedAfter.push(options.lastEventId);
        return events(options.lastEventId);
      },
    })),
  );
  const queries = threadQueries({ client, orpc: createTanstackQueryUtils(client) });
  return { queries, queryClient: new QueryClient(), resumedAfter };
};

const rowAt = (line: number) => ({
  at: line,
  event: { text: `Reply ${String(line)}`, type: "agent.message" },
  eventId: `1:${String(line)}:0`,
  threadId: THREAD,
  type: "agent.message",
});

describe("a conversation as every device reads it", () => {
  it("follows a thread's events and the reply's draft, then picks up after the last one held", async () => {
    const stored = [rowAt(1), rowAt(2)];
    const { queries, queryClient, resumedAfter } = device({
      events: async function* events(lastEventId) {
        const after = stored.findIndex(({ eventId }) => eventId === lastEventId);
        for (const row of stored.slice(after + 1)) {
          yield { kind: "event", row };
        }
        yield { kind: "caughtUp" };
        if (lastEventId === undefined) {
          yield { kind: "draft", text: "Wri" };
          yield { kind: "draft", text: "ting" };
        }
      },
    });
    const first = await queryClient.query(queries.threadEvents(THREAD));
    expect(first.rows.map(({ eventId }) => eventId)).toStrictEqual(["1:1:0", "1:2:0"]);
    expect(first.draft).toBe("Writing");

    stored.push(rowAt(3));
    const resumed = await queryClient.query(queries.threadEvents(THREAD));
    expect(resumed.rows.map(({ eventId }) => eventId)).toStrictEqual(["1:1:0", "1:2:0", "1:3:0"]);
    expect(resumed.draft).toBe("");
    expect(resumedAfter).toStrictEqual([undefined, "1:2:0"]);
  });

  it("reads every thread of the account, a page after a page", async () => {
    const { queries, queryClient } = device({
      threads: ({ cursor }) =>
        cursor === undefined
          ? { cursor: 1, threads: [{ id: "a" }] }
          : { cursor: null, threads: [{ id: "b" }] },
    });
    const read = await queryClient.query(queries.threads());
    expect(read.threads.map((row) => row.id)).toStrictEqual(["a", "b"]);
  });
});
