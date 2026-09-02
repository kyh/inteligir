import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { authorizationHeader } from "./server-file";

export interface LocalClientArgs {
  origin: string;
  token: string;
  timeoutMs: number;
}

export function createLocalClient(args: LocalClientArgs): ContractRouterClient<LocalContract> {
  const link = new RPCLink({
    // oRPC v2: `origin` is the host, `url` the mount path (must start with `/`).
    origin: args.origin,
    url: RPC_PREFIX,
    headers: () => ({ authorization: authorizationHeader(args.token) }),
    // merge with init.signal: oRPC passes the caller's per-call signal in init, and a bare { signal } would drop it.
    fetch: (url, init) => {
      const timeout = AbortSignal.timeout(args.timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return fetch(url, { ...init, signal });
    },
  });
  return createORPCClient(link);
}
