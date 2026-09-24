import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { AGENT_THREAD_HEADER } from "./agent-thread-header";
import { authorizationHeader } from "./server-file";

export interface LocalClientArgs {
  origin: string;
  token: string;
  timeoutMs: number;
  // the agent thread whose shell this client runs in, if any.
  agentThreadId?: string;
}

export const createLocalClient = (args: LocalClientArgs): ContractRouterClient<LocalContract> => {
  const link = new RPCLink({
    // merge with init.signal: oRPC passes the caller's per-call signal in init, and a bare { signal } would drop it.
    fetch: async (url, init) => {
      const timeout = AbortSignal.timeout(args.timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return await fetch(url, { ...init, signal });
    },
    // an undefined value sends no header at all.
    headers: () => ({
      [AGENT_THREAD_HEADER]: args.agentThreadId,
      authorization: authorizationHeader(args.token),
    }),
    // oRPC v2: `origin` is the host, `url` the mount path (must start with `/`).
    origin: args.origin,
    url: RPC_PREFIX,
  });
  return createORPCClient(link);
};
