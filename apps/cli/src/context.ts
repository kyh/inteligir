// The CLI's runtime context: which instance it drives, how a command reaches
// the typed client, and the context block `--help` prints. INTELIGIR_THREAD_ID
// is context only — commands take explicit ids; the variable tells an agent
// WHICH thread it is running in (the runtime injects it into agent shells).

import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { resolveCheckoutRoot } from "./server/dev-instance";
import { createLocalClient } from "./server/local-client";
import { DATA_DIR_ENV_VAR, resolveServer, type ResolvedServer } from "./server-discovery";

/** The typed surface every command drives. A refusal is a THROWN error, so
 *  there is no success-or-refusal value a command could print by mistake. */
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

/** A ceiling on ONE verb. Generous, because `action wait` and a first-boot
 *  vault scan are legitimately slow; the point is that a WEDGED server ends
 *  the command rather than leaving a shell — an agent's shell — hanging. */
const CALL_TIMEOUT_MS = 120_000;

/** The typed client, carrying this instance's bearer on every request. */
export function apiFor(deps: CliDeps): Api {
  const server = deps.resolveServer();
  return createLocalClient({
    origin: server.baseUrl,
    token: server.token,
    timeoutMs: CALL_TIMEOUT_MS,
  });
}

export function contextThreadId(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[THREAD_ID_ENV_VAR];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Whether this invocation runs inside an agent's shell. The thread id is the
 *  only signal — the runtime injects it there and nowhere else — so a verb
 *  that signs its work reads authorship off it. */
export function isAgentShell(env: NodeJS.ProcessEnv): boolean {
  return contextThreadId(env) !== undefined;
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
