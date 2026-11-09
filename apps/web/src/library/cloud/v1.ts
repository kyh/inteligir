// The page's one wire to its account: `/v1/rpc` on the origin that served the page, signed in by
// the session cookie the site's own sign-in set, so the page holds no credential and names no
// build (the Worker reads a same-origin page as its own deploy's). Every read and write of the
// library goes through these utils, as TanStack queries and mutations the page's one QueryClient
// holds.

import { createORPCClient, isDefinedError, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { sharedFailure } from "@repo/contract/library/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/library/call-outcome";
import { V1_RPC_PATH } from "@repo/contract/v1";
import type { V1Client } from "@repo/contract/v1";
import { QueryClient } from "@tanstack/react-query";

export type V1Queries = ReturnType<typeof createTanstackQueryUtils<V1Client>>;

export interface CloudWire {
  readonly client: V1Client;
  readonly orpc: V1Queries;
}

// how a call's failure ended the page's sign-in, if it did
/** @internal */
export const sessionEndOf = (cause: unknown): SessionEnd | null => {
  const failure = cause instanceof Error ? sharedFailure(cause) : null;
  return failure?.kind === "session" ? failure.end : null;
};

// CLAUDE.md § A SESSION'S END IS ANSWERED HOWEVER THE PAGE MEETS IT.
export const createCloudWire = (
  transport: V1Transport,
  onSessionEnd: (end: SessionEnd) => void,
): CloudWire => {
  const link = new RPCLink({
    fetch: async (url, init) => await transport.fetch(new Request(url, init)),
    // the link's own interceptor sees every call's failure once, before its caller does
    interceptors: [
      onError((cause: unknown) => {
        const end = sessionEndOf(cause);
        if (end !== null) {
          onSessionEnd(end);
        }
      }),
    ],
    origin: transport.origin,
    url: V1_RPC_PATH,
  });
  const client: V1Client = createORPCClient(link);
  return { client, orpc: createTanstackQueryUtils(client) };
};

// a refusal the procedure declared answers the same however often it is asked, so only a call that
// met no answer goes again
const QUERY_RETRIES = 3;
export const retryUnlessRefused = (failures: number, cause: unknown): boolean =>
  !isDefinedError(cause) && failures < QUERY_RETRIES;

// The defaults every query starts from. A cell call is `online`, so with no connection it pauses
// rather than failing, and the screen says it needs one (`needs-connection.tsx`). The account's
// socket says what moved (`use-library-socket.ts`), so a window coming back into focus refetches
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
