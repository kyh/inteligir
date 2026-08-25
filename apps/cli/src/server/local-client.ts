// HOW DO I DIAL THE LOCAL SERVER? Answered once, here.
//
// Three callers need the same client — the CLI's verbs, the desktop shell's
// readiness probe, and the in-app browser's "send page to agent" — and each
// had its own five lines. They had already drifted: only the probe carried a
// timeout, so a wedged server hung the other two forever with nothing to
// cancel.
//
// The token is passed rather than read here on purpose. WHICH instance a
// caller means is its own question (the CLI derives it from a checkout, the
// shell from the data dir it forked against); this only knows how to speak to
// one once it has been named.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { authorizationHeader } from "./server-file";

export interface LocalClientArgs {
  /** `http://127.0.0.1:<bound port>` — the port `server.json` names. */
  origin: string;
  token: string;
  /** A ceiling on ONE call. A local server that stopped answering must not
   *  hang the caller: the CLI would never exit and the shell's IPC handler
   *  would never reply. */
  timeoutMs: number;
}

export function createLocalClient(args: LocalClientArgs): ContractRouterClient<LocalContract> {
  const link = new RPCLink({
    // v2 splits the base: `origin` is the host, `url` the path prefix the
    // handler is mounted under (a `StandardUrl`, so it must start with `/`).
    origin: args.origin,
    url: RPC_PREFIX,
    headers: () => ({ authorization: authorizationHeader(args.token) }),
    // COMPOSE, never replace: oRPC hands the custom fetch its own `init` carrying
    // the caller's per-call signal (e.g. `action wait --timeout`'s wall-clock
    // bound). Merging the timeout with `init.signal` keeps both — a bare
    // `{ signal }` would drop the per-call deadline and the rest of the init.
    fetch: (url, init) => {
      const timeout = AbortSignal.timeout(args.timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return fetch(url, { ...init, signal });
    },
  });
  return createORPCClient(link);
}
