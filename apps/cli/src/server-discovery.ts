// Where is the local server? INTELIGIR_SERVER_URL wins (it is injected into
// agent shells); otherwise the CLI derives candidates the same way the app
// derives its own listen port — by REUSING the app's config module, so the
// two can never disagree on the scheme — and probes them. The altitude call,
// stated: `@repo/app/node/config` is imported directly (it drags only node
// builtins + zod, no server machinery) instead of duplicating the derivation
// here or extracting a package for one shared file; candidate enumeration,
// probing and IDENTITY are the only CLI-local logic.
//
// Identity is the part a health probe alone cannot give. A derived dev port
// is probed upward, so the first responder on the range may be a NEIGHBOURING
// checkout's server — and writing a note into someone else's vault is a
// silent, destructive wrong answer. So a probed candidate must also AGREE
// with the data dir this checkout's own config resolution derived. An
// explicitly named server skips the check on purpose: you named it, you own
// it — and `inteligir status` prints the data dir and vault it bound to.

import { DEV_PORT_PROBE_LIMIT, PROD_SERVER_PORT, resolveAppConfig } from "@repo/app/node/config";
import { healthResponseSchema, systemStatusResponseSchema } from "@repo/server-contract/routes";
import { CliExitError, EXIT_UNREACHABLE } from "./cli-error";

export const SERVER_URL_ENV_VAR = "INTELIGIR_SERVER_URL";

const PROBE_TIMEOUT_MS = 1_500;

export type ServerCandidates =
  | { kind: "url"; baseUrl: string }
  | { kind: "ports"; ports: number[]; expectedDataDir: string };

export interface ResolvedServer {
  baseUrl: string;
  /** How the CLI decided on it — printed by `status`, because "explicit" is
   *  also a statement that no identity check ran. */
  source: "explicit" | "discovered";
}

function parseServerUrl(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/u, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CliExitError(`${SERVER_URL_ENV_VAR} is not a valid URL (got "${rawValue}")`, {
      code: "invalid_server_url",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliExitError(`${SERVER_URL_ENV_VAR} must be an http(s) URL (got "${rawValue}")`, {
      code: "invalid_server_url",
    });
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
    return { kind: "ports", ports: [config.port], expectedDataDir: config.dataDir };
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
  return { kind: "ports", ports, expectedDataDir: config.dataDir };
}

export type ProbeFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

async function fetchJson(url: string, fetchImpl: ProbeFetch): Promise<unknown> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!response.ok) {
    return undefined;
  }
  return response.json().catch(() => undefined);
}

type ProbeOutcome =
  | { kind: "match" }
  | { kind: "silent" }
  /** A real inteligir server — someone else's. */
  | { kind: "foreign"; dataDir: string };

async function probeCandidate(
  baseUrl: string,
  expectedDataDir: string,
  fetchImpl: ProbeFetch,
): Promise<ProbeOutcome> {
  try {
    // The body shape, not just a 2xx: another local service on the port can
    // answer 200 with anything.
    const health = await fetchJson(`${baseUrl}/api/v1/health`, fetchImpl);
    if (!healthResponseSchema.safeParse(health).success) {
      return { kind: "silent" };
    }
    const status = systemStatusResponseSchema.safeParse(
      await fetchJson(`${baseUrl}/api/v1/system/status`, fetchImpl),
    );
    if (!status.success) {
      return { kind: "silent" };
    }
    return status.data.dataDir === expectedDataDir
      ? { kind: "match" }
      : { kind: "foreign", dataDir: status.data.dataDir };
  } catch {
    return { kind: "silent" };
  }
}

export interface ResolveServerArgs extends DeriveServerCandidatesArgs {
  fetchImpl?: ProbeFetch;
}

export async function resolveServer(args: ResolveServerArgs): Promise<ResolvedServer> {
  const candidates = deriveServerCandidates(args);
  // An explicit URL is trusted without a probe: the first real request will
  // say plainly when it is wrong, and probing it first would only double
  // every call's latency.
  if (candidates.kind === "url") {
    return { baseUrl: candidates.baseUrl, source: "explicit" };
  }
  const fetchImpl: ProbeFetch = args.fetchImpl ?? ((url, init) => fetch(url, init));
  const foreign: string[] = [];
  for (const port of candidates.ports) {
    const baseUrl = `http://127.0.0.1:${port}`;
    const outcome = await probeCandidate(baseUrl, candidates.expectedDataDir, fetchImpl);
    if (outcome.kind === "match") {
      return { baseUrl, source: "discovered" };
    }
    if (outcome.kind === "foreign") {
      foreign.push(`${baseUrl} serves ${outcome.dataDir}`);
    }
  }
  const conflict =
    foreign.length === 0
      ? ""
      : ` Another inteligir server answered but serves a different instance: ${foreign.join("; ")}.`;
  throw new CliExitError(
    `No inteligir server for ${candidates.expectedDataDir} found (tried 127.0.0.1 port` +
      `${candidates.ports.length === 1 ? "" : "s"} ${candidates.ports.join(", ")}).${conflict}` +
      ` Start one with \`pnpm dev\`, or point the CLI at it with ${SERVER_URL_ENV_VAR}.`,
    { code: "server_unreachable", exitCode: EXIT_UNREACHABLE },
  );
}
