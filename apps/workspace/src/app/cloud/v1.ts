// The page's one wire to its account: `/v1/rpc` through the transport its host hands it. In the
// browser tab that is the origin that served the page, signed in by the session cookie the site's
// own sign-in set, so the tab holds no credential and names no build (the Worker reads a
// same-origin page as its own deploy's); in the Mac app it is the cloud's origin with the device's
// credential and the build. Every call the replica does not answer (History, the built-in agent,
// imports, exports, the account) goes through these utils, as TanStack queries and mutations the
// page's one QueryClient holds.

import { createORPCClient, isDefinedError, onError, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { ReplicaTransport } from "@repo/library-replica/replica-ports";
import { QueryClient } from "@tanstack/react-query";

type V1Queries = ReturnType<typeof createTanstackQueryUtils<V1Client>>;

export interface CloudWire {
  readonly client: V1Client;
  readonly orpc: V1Queries;
}

// a call met a session that ended (signed out elsewhere, the account deleted): the page has no
// library to show, so it goes to the sign-in that brings it back here
/** @internal */
export const sessionEnded = (cause: unknown): boolean =>
  cause instanceof ORPCError &&
  cause.defined &&
  (cause.code === "UNAUTHORIZED" || cause.code === "GONE");

export const createCloudWire = (
  transport: ReplicaTransport,
  onSessionEnd: () => void,
): CloudWire => {
  const link = new RPCLink({
    fetch: async (url, init) => await transport.fetch(new Request(url, init)),
    // the link's own interceptor sees every call's failure once, before its caller does
    interceptors: [
      onError((cause: unknown) => {
        if (sessionEnded(cause)) {
          onSessionEnd();
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
/** @internal */
export const retryUnlessRefused = (failures: number, cause: unknown): boolean =>
  !isDefinedError(cause) && failures < QUERY_RETRIES;

// The defaults every query starts from. A cell call is `online`, so with no connection it pauses
// rather than failing, and the screen says it needs one (`needs-connection.tsx`); a replica read
// opts into `always` where it is declared (`replica-queries.ts`), since it reads this device's own
// rows. The replica's change feed and the socket move what a screen shows, so a window coming back
// into focus refetches nothing.
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
