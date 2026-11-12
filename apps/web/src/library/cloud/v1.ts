// The page's one wire to its account: `/v1/rpc` on the origin that served the page, signed in by
// the session cookie the site's own sign-in set, so the page holds no credential and names no
// build (the Worker reads a same-origin page as its own deploy's). Every read and write of the
// library goes through these utils, as TanStack queries and mutations the page's one QueryClient
// holds.

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { retryUnlessRefused } from "@repo/client/library-cache";
import type { V1Queries } from "@repo/client/library-cache";
import { v1Client } from "@repo/contract/library/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/library/call-outcome";
import type { V1Client } from "@repo/contract/v1";
import { QueryClient } from "@tanstack/react-query";

export interface CloudWire {
  readonly client: V1Client;
  readonly orpc: V1Queries;
}

// CLAUDE.md § A session's end is answered however the tab meets it.
export const createCloudWire = (
  transport: V1Transport,
  onSessionEnd: (end: SessionEnd) => void,
): CloudWire => {
  const client = v1Client(transport, onSessionEnd);
  return { client, orpc: createTanstackQueryUtils(client) };
};

// The defaults every query starts from. A cell call is `online`, so with no connection it pauses
// rather than failing, and the screen says it needs one (`needs-connection.tsx`). The account's
// socket says what moved (`@repo/client/library-cache`), so a window coming back into focus refetches
// nothing.
export const createPageQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "online" },
      queries: {
        networkMode: "online",
        refetchOnWindowFocus: false,
        retry: retryUnlessRefused,
      },
    },
  });
