// The CLI's runtime context: which instance it drives, how a command reaches
// the typed client, and the context block `--help` prints. INTELIGIR_THREAD_ID
// is context only — commands take explicit ids; the variable tells an agent
// WHICH thread it is running in (the runtime injects it into agent shells).

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorizationHeader } from "@repo/app/node/server-file";
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import { DATA_DIR_ENV_VAR, resolveServer, type ResolvedServer } from "./server-discovery";

const THREAD_ID_ENV_VAR = "INTELIGIR_THREAD_ID";

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  /** Resolved on the first command that needs the server, then cached. */
  resolveServer(): ResolvedServer;
}

/**
 * The sibling apps/app checkout, which is what the server hashes as its cwd
 * for the per-checkout data dir derivation. Structural: the CLI and the app
 * ship in one checkout, and this module sits one level under the CLI package
 * root both in src/ and in the dist/ bundle. realpath'd because the server
 * hashes its (real) cwd.
 */
function defaultAppCheckoutDir(): string {
  const cliPackageDir = fileURLToPath(new URL("..", import.meta.url));
  const appDir = resolve(cliPackageDir, "..", "app");
  try {
    return realpathSync(appDir);
  } catch {
    return appDir;
  }
}

export function createCliDeps(env: NodeJS.ProcessEnv = process.env): CliDeps {
  let cached: ResolvedServer | null = null;
  return {
    env,
    resolveServer() {
      cached ??= resolveServer({ env, appCheckoutDir: defaultAppCheckoutDir() });
      return cached;
    },
  };
}

/**
 * The typed client, carrying this instance's bearer on every request. The
 * header is attached HERE and nowhere else: one place that knows the CLI holds
 * a credential at all.
 */
export function apiFor(deps: CliDeps): ApiClient {
  const server = deps.resolveServer();
  return createApiClient(server.baseUrl, {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", authorizationHeader(server.token));
      return fetch(input, { ...init, headers });
    },
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
