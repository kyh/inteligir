// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";
import { agentModeSchema, agentModeValues } from "@repo/contract/local/system/system-schema";
import type { AgentMode } from "@repo/contract/local/system/system-schema";
import { DEBUG_NAMESPACES, parseDebugNamespaces } from "./debug-log";
import type { DebugNamespace } from "./debug-log";
import { resolveDevDefaultPort, resolveDevInstanceId } from "./dev-instance";
import { errnoCode } from "./errno";

type RuntimeMode = "dev" | "prod";

export const PROD_DATA_DIR_NAME = ".inteligir";
export const DATA_DIR_ENV_VAR = "INTELIGIR_DATA_DIR";
export const DEV_DATA_ROOT_DIR = ".inteligir-dev";
// a checkout's instance keeps its data one level down, as every checkout before this one did
const DEV_INSTANCE_DATA_DIR_NAME = "data";
const SQLITE_DATABASE_FILE_NAME = "inteligir.db";
const CONFIG_FILE_NAME = "config.json";
export const PROD_SERVER_PORT = 4664;

interface EnvVarDefinition<TValue> {
  description: string;
  name: string;
  parse: (args: { homeDir: string; name: string; value: string }) => TValue;
}

const defineEnvVar = <TValue>(definition: EnvVarDefinition<TValue>): EnvVarDefinition<TValue> =>
  definition;

const parseDataDirValue = (name: string, rawValue: string, homeDir: string): string => {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/")) {
    return path.resolve(homeDir, trimmed.slice(2));
  }
  // before path.resolve(): a relative value would anchor to whatever cwd the process started in.
  if (!path.isAbsolute(trimmed)) {
    throw new Error(
      `${name} must be an absolute path (got "${trimmed}"). Pass an absolute path, or a ~/ path for a home-relative one.`,
    );
  }
  return path.resolve(trimmed);
};

// origin only: `new URL("/v1/…", base)` drops any path the base carries.
const parseCloudUrlValue = (name: string, rawValue: string): string => {
  const trimmed = rawValue.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL (got "${trimmed}")`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be an http:// or https:// URL (got "${trimmed}")`);
  }
  return url.origin;
};

const parseAgentModeValue = (name: string, rawValue: string): AgentMode => {
  const parsed = agentModeSchema.safeParse(rawValue.trim());
  if (!parsed.success) {
    throw new Error(
      `${name} must be one of ${agentModeValues.join(", ")} (got "${rawValue.trim()}")`,
    );
  }
  return parsed.data;
};

// shared with serve's --port, so the flag accepts exactly what INTELIGIR_PORT does.
export const parsePortValue = (name: string, rawPort: string): number => {
  const port = Number(rawPort);
  if (String(port) !== rawPort || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
};

const ENV_VARS = {
  agent: defineEnvVar({
    description:
      "Agent runtime selection: auto (this build's agent runtime, which is none yet, so a send is refused), scripted (in-process fake for e2e), or off.",
    name: "INTELIGIR_AGENT",
    parse: ({ name, value }) => parseAgentModeValue(name, value),
  }),
  cloudUrl: defineEnvVar({
    description: `Origin of the hosted deployment this install signs in to for thread sync; unset means ${PRODUCTION_CLOUD_ORIGIN}. Signing in is what turns sync on — an install with no device credential opens no socket and makes no request whatever this says.`,
    name: "INTELIGIR_CLOUD_URL",
    parse: ({ name, value }) => parseCloudUrlValue(name, value),
  }),
  dataDir: defineEnvVar({
    description:
      "Absolute (or ~-relative) data directory override; replaces both the prod and per-checkout dev defaults.",
    name: DATA_DIR_ENV_VAR,
    parse: ({ homeDir, name, value }) => parseDataDirValue(name, value, homeDir),
  }),
  debug: defineEnvVar({
    description: `Comma-separated diagnostics written to stderr (${DEBUG_NAMESPACES.join(", ")}): the decisions each makes, by id, never a message's content or a credential. Unset means none.`,
    name: "INTELIGIR_DEBUG",
    parse: ({ name, value }) => parseDebugNamespaces(name, value),
  }),
  port: defineEnvVar({
    description: "TCP port for the local server.",
    name: "INTELIGIR_PORT",
    parse: ({ name, value }) => parsePortValue(name, value.trim()),
  }),
};

// apps/desktop/turbo.json's dev.passThroughEnv must name exactly these: turbo strips anything
// unnamed in strict env mode, so a missing one is silently ignored under `pnpm dev`.
export const ENV_VAR_NAMES: readonly string[] = Object.values(ENV_VARS)
  .map((definition) => definition.name)
  .toSorted();

const readEnvVar = <TValue>(
  definition: EnvVarDefinition<TValue>,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): TValue | undefined => {
  const rawValue = env[definition.name];
  if (rawValue === undefined) {
    return undefined;
  }
  return definition.parse({ homeDir, name: definition.name, value: rawValue });
};

// lenient: unknown keys from a newer build, or an older one's, must not brick this one.
const managedConfigSchema = z.object({
  agent: agentModeSchema.optional(),
  cloudUrl: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
});

type ManagedConfig = z.infer<typeof managedConfigSchema>;

const readManagedConfigFile = (dataDir: string): ManagedConfig => {
  const configPath = path.join(dataDir, CONFIG_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return {};
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${configPath} is not valid JSON`);
  }
  const verdict = managedConfigSchema.safeParse(parsed);
  if (!verdict.success) {
    throw new Error(
      `${configPath} does not match the ${CONFIG_FILE_NAME} shape:\n${z.prettifyError(verdict.error)}`,
    );
  }
  return verdict.data;
};

type ConfigSource = "env" | "managed-config" | "default";

export interface AppConfig {
  databasePath: string;
  dataDir: string;
  dataDirSource: "env" | "default";
  mode: RuntimeMode;
  port: number;
  portSource: ConfigSource;
  agent: AgentMode;
  cloudUrl: string;
  debug: ReadonlySet<DebugNamespace>;
}

export interface ResolveAppConfigArgs {
  checkoutPath: string;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
}

const configSource = <T>(envValue: T | undefined, managedValue: T | undefined): ConfigSource => {
  if (envValue !== undefined) {
    return "env";
  }
  if (managedValue !== undefined) {
    return "managed-config";
  }
  return "default";
};

const resolveCloudUrl = (
  args: ResolveAppConfigArgs,
  homeDir: string,
  managed: ManagedConfig,
): string =>
  readEnvVar(ENV_VARS.cloudUrl, args.env, homeDir) ??
  (managed.cloudUrl === undefined
    ? PRODUCTION_CLOUD_ORIGIN
    : parseCloudUrlValue("config.json cloudUrl", managed.cloudUrl));

export const runtimeModeOf = (env: NodeJS.ProcessEnv): RuntimeMode =>
  env.NODE_ENV === "production" ? "prod" : "dev";

export const resolveAppConfig = (args: ResolveAppConfigArgs): AppConfig => {
  const homeDir = args.homeDir ?? homedir();
  const mode = runtimeModeOf(args.env);

  const envDataDir = readEnvVar(ENV_VARS.dataDir, args.env, homeDir);
  const dataDir =
    envDataDir ??
    (mode === "prod"
      ? path.join(homeDir, PROD_DATA_DIR_NAME)
      : path.join(
          homeDir,
          DEV_DATA_ROOT_DIR,
          resolveDevInstanceId(args.checkoutPath),
          DEV_INSTANCE_DATA_DIR_NAME,
        ));

  const managed = readManagedConfigFile(dataDir);

  const envPort = readEnvVar(ENV_VARS.port, args.env, homeDir);
  const port =
    envPort ??
    managed.port ??
    (mode === "prod" ? PROD_SERVER_PORT : resolveDevDefaultPort(args.checkoutPath));

  return {
    agent: readEnvVar(ENV_VARS.agent, args.env, homeDir) ?? managed.agent ?? "auto",
    cloudUrl: resolveCloudUrl(args, homeDir, managed),
    dataDir,
    dataDirSource: envDataDir === undefined ? "default" : "env",
    databasePath: path.join(dataDir, SQLITE_DATABASE_FILE_NAME),
    debug: readEnvVar(ENV_VARS.debug, args.env, homeDir) ?? new Set(),
    mode,
    port,
    portSource: configSource(envPort, managed.port),
  };
};
