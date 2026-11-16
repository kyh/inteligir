import { createORPCClient, DynamicLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { V1Client } from "@repo/contract/v1";

import { threadQueries } from "./thread-queries";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";

const asked = z.object({ after: z.number().optional(), cursor: z.number().optional() });

// a device over a cloud that answers a page from what each call asked after
const device = (answer: (input: z.infer<typeof asked>) => object) => {
  const calls: z.infer<typeof asked>[] = [];
  const client = createORPCClient<V1Client>(
    new DynamicLink((_options, _path, input) => {
      const call = asked.parse(input);
      calls.push(call);
      return { call: async () => await Promise.resolve(answer(call)) };
    }),
  );
  const queries = threadQueries({ client, orpc: createTanstackQueryUtils(client) });
  return { calls, queries, queryClient: new QueryClient() };
};

describe("a conversation as every device reads it", () => {
  it("reads a thread's events to the last page, then only what came after the last one held", async () => {
    const stored = [0, 1].map((idx) => ({ idx }));
    const { calls, queries, queryClient } = device(({ after = -1 }) => ({
      events: stored.filter((row) => row.idx > after).slice(0, 1),
      more: stored.some((row) => row.idx > after + 1),
    }));
    await queryClient.query(queries.threadEvents(THREAD));
    stored.push({ idx: 2 });
    const read = await queryClient.query(queries.threadEvents(THREAD));
    expect(read.events.map((row) => row.idx)).toStrictEqual([0, 1, 2]);
    expect(calls.map((call) => call.after)).toStrictEqual([undefined, 0, 1]);
  });

  it("reads every thread of the account, a page after a page", async () => {
    const { queries, queryClient } = device(({ cursor }) =>
      cursor === undefined
        ? { cursor: 1, threads: [{ id: "a" }] }
        : { cursor: null, threads: [{ id: "b" }] },
    );
    const read = await queryClient.query(queries.threads());
    expect(read.threads.map((row) => row.id)).toStrictEqual(["a", "b"]);
  });
});
