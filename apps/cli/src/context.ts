// The CLI's runtime context: which instance it drives, how a command reaches
// the typed client, and the context block `--help` prints. INTELIGIR_THREAD_ID
// is context only — commands take explicit ids; the variable tells an agent
// WHICH thread it is running in (the runtime injects it into agent shells).

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { resolveCheckoutRoot } from "./server/config";
import { authorizationHeader } from "./server/server-file";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { DATA_DIR_ENV_VAR, resolveServer, type ResolvedServer } from "./server-discovery";

/** The typed surface every command drives. A refusal is a THROWN error, so
 *  there is no success-or-refusal value a command could print by mistake —
 *  which is the invariant a status-checking helper used to have to enforce. */
export type Api = ContractRouterClient<LocalContract>;

const THREAD_ID_ENV_VAR = "INTELIGIR_THREAD_ID";

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  /** Resolved on the first command that needs the server, then cached. */
  resolveServer(): ResolvedServer;
}

export function createCliDeps(env: NodeJS.ProcessEnv = process.env): CliDeps {
  let cached: ResolvedServer | null = null;
  return {
    env,
    resolveServer() {
      cached ??= resolveServer({ env, checkoutPath: resolveCheckoutRoot() });
      return cached;
    },
  };
}

/**
 * The typed client, carrying this instance's bearer on every request. The
 * header thunk is the ONE place that knows the CLI holds a credential at all.
 */
export function apiFor(deps: CliDeps): Api {
  const server = deps.resolveServer();
  const link = new RPCLink({
    url: `${server.baseUrl}${RPC_PREFIX}`,
    headers: () => ({ authorization: authorizationHeader(server.token) }),
  });
  return createORPCClient(link);
}

export function contextThreadId(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[THREAD_ID_ENV_VAR];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The `--help` epilogue: what this invocation would actually dial and run in. */
export function describeContext(env: NodeJS.ProcessEnv): string {
  const dataDir = env[DATA_DIR_ENV_VAR]?.trim();
  const threadId = contextThreadId(env);
  return [
    "",
    "Environment:",
    `  ${DATA_DIR_ENV_VAR}: ${dataDir !== undefined && dataDir.length > 0 ? dataDir : "(unset — derived from this checkout)"}`,
    `  ${THREAD_ID_ENV_VAR}:  ${threadId ?? "(unset)"}`,
    "",
    "Run `inteligir guide` for the agent manual.",
  ].join("\n");
}
