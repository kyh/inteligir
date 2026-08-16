// The CLI's runtime context: which env it reads, how a command reaches the
// typed client, and the context block `--help` prints. INTELIGIR_THREAD_ID is
// context only — commands take explicit ids; the variable tells an agent
// WHICH thread it is running in (the runtime injects it into agent shells).

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import { resolveServerBaseUrl, SERVER_URL_ENV_VAR } from "./server-discovery";

const THREAD_ID_ENV_VAR = "INTELIGIR_THREAD_ID";

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  /** Resolved lazily on the first command that needs the server, then cached. */
  resolveServer(): Promise<string>;
}

/**
 * The sibling apps/app checkout, which is what the server hashes as its cwd
 * for the per-checkout port derivation. Structural: the CLI and the app ship
 * in one checkout, and this module sits one level under the CLI package root
 * both in src/ and in the dist/ bundle. realpath'd because the server hashes
 * its (real) cwd.
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
  let cached: Promise<string> | null = null;
  return {
    env,
    resolveServer() {
      cached ??= resolveServerBaseUrl({ env, appCheckoutDir: defaultAppCheckoutDir() });
      return cached;
    },
  };
}

export async function apiFor(deps: CliDeps): Promise<ApiClient> {
  return createApiClient(await deps.resolveServer());
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
  const serverUrl = env[SERVER_URL_ENV_VAR]?.trim();
  const threadId = contextThreadId(env);
  return [
    "",
    "Environment:",
    `  ${SERVER_URL_ENV_VAR}: ${serverUrl !== undefined && serverUrl.length > 0 ? serverUrl : "(unset — discovered from the local instance)"}`,
    `  ${THREAD_ID_ENV_VAR}:  ${threadId ?? "(unset)"}`,
    "",
    "Run `inteligir guide` for the agent manual.",
  ].join("\n");
}
