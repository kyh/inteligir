import { createORPCClient, DynamicLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { V1Client } from "@repo/contract/rpc/v1-contract";

import { threadQueries } from "./thread-queries";

const asked = z.object({ cursor: z.number().optional() });

const device = (threads: (input: z.infer<typeof asked>) => object) => {
  const client = createORPCClient<V1Client>(
    new DynamicLink((_options, _path, input) => ({
      call: async () => await Promise.resolve(threads(asked.parse(input))),
    })),
  );

  const queries = threadQueries({ client, orpc: createTanstackQueryUtils(client) });

  return { queries, queryClient: new QueryClient() };
};

describe("the agent's conversations as every device reads them", () => {
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
