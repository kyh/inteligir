// Where is the local server? INTELIGIR_SERVER_URL wins (it is injected into
// agent shells); otherwise the CLI derives candidates the same way the app
// derives its own listen port — by REUSING the app's config module, so the
// two can never disagree on the scheme — and probes them with the health
// route. The altitude call, stated: `@repo/app/node/config` is imported
// directly (it drags only node builtins + zod, no server machinery) instead
// of duplicating the derivation here or extracting a package for one shared
// file; candidate enumeration + probing is the only CLI-local logic.

import { DEV_PORT_PROBE_LIMIT, PROD_SERVER_PORT, resolveAppConfig } from "@repo/app/node/config";
import { healthResponseSchema } from "@repo/server-contract/routes";
import { CliExitError, EXIT_UNREACHABLE } from "./cli-error";

export const SERVER_URL_ENV_VAR = "INTELIGIR_SERVER_URL";

const PROBE_TIMEOUT_MS = 1_500;

export type ServerCandidates =
  | { kind: "url"; baseUrl: string }
  | { kind: "ports"; ports: number[] };

function parseServerUrl(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/u, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CliExitError(`${SERVER_URL_ENV_VAR} is not a valid URL (got "${rawValue}")`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliExitError(`${SERVER_URL_ENV_VAR} must be an http(s) URL (got "${rawValue}")`);
  }
  return trimmed;
}

export interface DeriveServerCandidatesArgs {
  env: NodeJS.ProcessEnv;
  /** The sibling apps/app checkout — what the server hashes as its cwd. */
  appCheckoutDir: string;
  homeDir?: string;
}

export function deriveServerCandidates(args: DeriveServerCandidatesArgs): ServerCandidates {
  const explicitUrl = args.env[SERVER_URL_ENV_VAR];
  if (explicitUrl !== undefined && explicitUrl.trim().length > 0) {
    return { kind: "url", baseUrl: parseServerUrl(explicitUrl) };
  }

  const config = resolveAppConfig({
    checkoutPath: args.appCheckoutDir,
    env: args.env,
    ...(args.homeDir !== undefined ? { homeDir: args.homeDir } : {}),
  });

  // A configured port is exact — the server never probes off one, so neither
  // does the CLI.
  if (config.portSource !== "default") {
    return { kind: "ports", ports: [config.port] };
  }

  // A derived dev port may have been probed upward at bind; try the same
  // range, then the installed prod default — the CLI's own NODE_ENV says
  // nothing about which mode the RUNNING server booted in.
  const ports: number[] = [];
  if (config.mode === "dev") {
    for (let offset = 0; offset < DEV_PORT_PROBE_LIMIT; offset += 1) {
      ports.push(config.port + offset);
    }
  }
  if (!ports.includes(PROD_SERVER_PORT)) {
    ports.push(PROD_SERVER_PORT);
  }
  return { kind: "ports", ports };
}

export type ProbeFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

async function answersHealth(baseUrl: string, fetchImpl: ProbeFetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    // The body shape, not just a 2xx: another local service on the port can
    // answer 200 with anything.
    const body: unknown = await response.json().catch(() => undefined);
    return healthResponseSchema.safeParse(body).success;
  } catch {
    return false;
  }
}

export interface ResolveServerBaseUrlArgs extends DeriveServerCandidatesArgs {
  fetchImpl?: ProbeFetch;
}

export async function resolveServerBaseUrl(args: ResolveServerBaseUrlArgs): Promise<string> {
  const candidates = deriveServerCandidates(args);
  // An explicit URL is trusted without a probe: the first real request will
  // say plainly when it is wrong, and probing it first would only double
  // every call's latency.
  if (candidates.kind === "url") {
    return candidates.baseUrl;
  }
  const fetchImpl: ProbeFetch = args.fetchImpl ?? ((url, init) => fetch(url, init));
  for (const port of candidates.ports) {
    const baseUrl = `http://127.0.0.1:${port}`;
    if (await answersHealth(baseUrl, fetchImpl)) {
      return baseUrl;
    }
  }
  throw new CliExitError(
    `No running inteligir server found (tried 127.0.0.1 port${candidates.ports.length === 1 ? "" : "s"} ` +
      `${candidates.ports.join(", ")}). Start one with \`pnpm dev\`, or point the CLI at it with ` +
      `${SERVER_URL_ENV_VAR}.`,
    EXIT_UNREACHABLE,
  );
}
