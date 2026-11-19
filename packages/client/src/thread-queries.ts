import { PAGE_MAX } from "@repo/contract/library/library-wire";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

import type { V1Queries } from "./library-cache";
import { threadStream } from "./thread-stream";

export const threadQueries = ({
  client,
  orpc,
}: {
  readonly client: V1Client;
  readonly orpc: V1Queries;
}) => ({
  threadEvents: threadStream({ client, orpc }),

  threads: () =>
    orpc.library.agent.list.queryOptions({
      input: {},
      queryFn: async ({ signal }) => {
        const threads = [];
        let cursor: number | undefined;

        do {
          const page = await client.library.agent.list({ cursor, limit: PAGE_MAX }, { signal });
          threads.push(...page.threads);
          cursor = page.cursor ?? undefined;
        } while (cursor !== undefined);

        return { cursor: null, threads };
      },
    }),
});
