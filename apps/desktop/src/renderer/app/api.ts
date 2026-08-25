// The workspace's server seam: ONE oRPC client against the local origin, and
// the query utilities every cache reader shares.
//
// THE KEYS ARE GENERATED, not written. `createTanstackQueryUtils` derives a
// query key from a procedure's position in the router, so a leaf key cannot
// drift from the procedure it names and a family sweep cannot name a family
// that does not exist. What was a hand-maintained `queryKeys` object is now
// `orpc.<router>.key()` for a family and `orpc.<router>.<procedure>` for a
// leaf.
//
// THE DEFAULT IS TARGETED INVALIDATION — each mutation sweeps the queries it
// affects, in its own `onSuccess`. Two families are the stated exception and
// are swept WHOLE: `vault` and `knowledge`. A link into a note lives in
// ANOTHER note's bytes, and relatedness blends links, tags and text from
// across the vault, so no path-scoped invalidation is expressible for either —
// the sweep is at the router, and the next derived read inherits it.
//
// @see https://orpc.dev/docs/integrations/tanstack-query

import { createORPCClient, isDefinedError, onError, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";

function isAbort(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

/**
 * The link. No `headers` thunk and no credential: the page is served by the
 * server it talks to, so the device token rides the same-origin cookie the
 * document set (`server-file.ts` states why the browser gets that carrier and
 * why script cannot read it).
 */
const link = new RPCLink({
  origin: () => window.location.origin,
  url: RPC_PREFIX,
  interceptors: [
    onError((cause: unknown) => {
      // A cancelled query is ORDINARY: react-query aborts an in-flight fetch
      // when its last observer unmounts, and oRPC honours the signal. Logging
      // that is noise — and noise the scenario suite reads as a broken page,
      // because it asserts a clean console.
      if (import.meta.env.DEV && !isAbort(cause)) {
        console.error(cause);
      }
    }),
  ],
});

export const client: ContractRouterClient<LocalContract> = createORPCClient(link);

/**
 * Typesafe query/mutation option builders — use with TanStack Query hooks:
 * `useQuery(orpc.knowledge.related.queryOptions({ input: { path } }))`.
 *
 * A plain module export rather than a React context: oRPC's utils are built
 * from the client, and the browser only ever has one.
 */
export const orpc = createTanstackQueryUtils(client);

/** The server's own refusal sentence when it sent one; anything else — a
 *  dropped connection, a thrown string — has none of its own to show, so the
 *  caller's fallback stands in. The ONE spelling of that choice. */
export function refusalMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

export { isDefinedError, safe };
