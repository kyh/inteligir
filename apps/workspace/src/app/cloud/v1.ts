// The page's one wire to its account: `/v1/rpc` on the origin that served the page, signed in by
// the session cookie the site's own sign-in set, so the page holds no credential and names no
// build (the Worker reads a same-origin page as its own deploy's). Every call the replica does not answer (Undo, the built-in agent,
// imports, exports, the account) goes through these utils, as TanStack queries and mutations the
// page's one QueryClient holds.

import { createORPCClient, isDefinedError, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import { sharedFailure } from "@repo/library-replica/call-outcome";
import type { SessionEnd } from "@repo/library-replica/call-outcome";
import type { LibraryReplica, ReplicaStatus } from "@repo/library-replica/library-replica";
import type { ReplicaTransport } from "@repo/library-replica/replica-ports";
import { QueryClient } from "@tanstack/react-query";

type V1Queries = ReturnType<typeof createTanstackQueryUtils<V1Client>>;

export interface CloudWire {
  readonly client: V1Client;
  readonly orpc: V1Queries;
}

// how a call's failure ended the page's sign-in, in the replica's own terms, if it did
/** @internal */
export const sessionEndOf = (cause: unknown): SessionEnd | null => {
  const failure = cause instanceof Error ? sharedFailure(cause) : null;
  return failure?.kind === "session" ? failure.end : null;
};

// CLAUDE.md § A SESSION'S END IS ANSWERED HOWEVER THE PAGE MEETS IT. The replica calls through a
// client of its own, which the wire's interceptor never hears, and an idle page makes no wire call.
// A status moves many times after one end, so each failure is answered once.
export const watchSessionEnd = (
  replica: Pick<LibraryReplica, "onStatus" | "status">,
  onSessionEnd: (end: SessionEnd) => void,
): void => {
  let answered: ReplicaStatus["failure"] = null;
  replica.onStatus(() => {
    const { failure } = replica.status();
    if (failure?.kind === "session" && failure !== answered) {
      answered = failure;
      onSessionEnd(failure.end);
    }
  });
};

export const createCloudWire = (
  transport: ReplicaTransport,
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
