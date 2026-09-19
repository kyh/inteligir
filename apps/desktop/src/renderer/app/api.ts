// mutations sweep the queries they affect in their own `onSuccess`, except `vault` and
// `knowledge`, swept whole: a link into a note lives in another note's bytes, so no
// path-scoped invalidation is expressible.

import { createORPCClient, onError } from "@orpc/client";

import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";

export { isDefinedError, safe } from "@orpc/client";

const isAbort = (cause: unknown): boolean => cause instanceof Error && cause.name === "AbortError";

// no `headers` thunk: the bearer is attached in main under `inteligir://app`, and by the same-origin cookie over plain HTTP.
const link = new RPCLink({
  interceptors: [
    onError((cause: unknown) => {
      // react-query aborts a fetch when its last observer unmounts; logging that fails the e2e suite's clean-console assertion.
      if (import.meta.env.DEV && !isAbort(cause)) {
        console.error(cause);
      }
    }),
  ],
  origin: () => window.location.origin,
  url: RPC_PREFIX,
});

export const client: ContractRouterClient<LocalContract> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

export const refusalMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
