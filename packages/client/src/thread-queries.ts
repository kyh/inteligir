// The agent's conversations as every device reads them: the account's threads, a query under oRPC's
// own key read again as an answer of what moved names them (`./library-cache`), and each thread's
// events as they happen (`./thread-stream`).

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

  // every thread of the account, newest first, since a conversation finds its title and status here
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
