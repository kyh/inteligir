// mutations sweep the queries they affect in their own `onSuccess`, except `vault` and
// `knowledge`, swept whole: a link into a note lives in another note's bytes, so no
// path-scoped invalidation is expressible.

import { createORPCClient, onError, onSuccess } from "@orpc/client";

import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { toast } from "@repo/ui/components/sonner";
import { observeGateRefusal } from "./signed-out-state";

export { isDefinedError, safe } from "@orpc/client";

const isAbort = (cause: unknown): boolean => cause instanceof Error && cause.name === "AbortError";

// no `headers` thunk: the bearer is attached in main under `inteligir://app`, and by the same-origin cookie over plain HTTP.
const link = new RPCLink({
  // the raw response, below the codec: the http gate's refusal is plain text, which the codec only
  // sees as a malformed body. its challenge is what marks it: a procedure's UNAUTHORIZED (a
  // mistyped cloud password) is a 401 too, and says nothing about this page's credential.
  fetchInterceptors: [
    onSuccess((response: Response) => {
      observeGateRefusal(response.status === 401 && response.headers.has("www-authenticate"));
    }),
  ],
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

export const failed = (cause: unknown, fallback: string): void => {
  toast.error(refusalMessage(cause, fallback));
};
