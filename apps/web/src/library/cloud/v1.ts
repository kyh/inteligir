// The page's one wire to its account: `/v1/rpc` on the origin that served the page, signed in by
// the session cookie the site's own sign-in set, so the page holds no credential and names no
// build (the Worker reads a same-origin page as its own deploy's). Every read and write of the
// library goes through these utils, as TanStack queries and mutations the page's one QueryClient
// holds.

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { retryUnlessRefused } from "@repo/client/library-cache";
import type { V1Queries } from "@repo/client/library-cache";
import { v1Client } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { QueryClient } from "@tanstack/react-query";

export interface CloudWire {
  readonly client: V1Client;
  readonly orpc: V1Queries;
  // the same calls, each sent as a keepalive request, which the browser carries past the page's
  // close; it holds 64 KiB for all of them at once, so only a small call goes this way
  readonly outliving: V1Client;
}

// CLAUDE.md § A session's end is answered however the tab meets it.
export const createCloudWire = (
  transport: V1Transport,
  onSessionEnd: (end: SessionEnd) => void,
): CloudWire => {
  const client = v1Client(transport, onSessionEnd);
  const outliving = v1Client(
    {
      fetch: async (request) => await transport.fetch(new Request(request, { keepalive: true })),
      origin: transport.origin,
    },
    onSessionEnd,
  );
  return { client, orpc: createTanstackQueryUtils(client), outliving };
};

// The defaults every query starts from. A cell call is `online`, so with no connection it pauses
// rather than failing, and the screen says it needs one (`needs-connection.tsx`). What moved is
// asked on its own (`@repo/client/library-changes`), so a window coming back into focus asks that
// and refetches nothing else.
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
