// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { errnoCode } from "./errno";

type RuntimeMode = "dev" | "prod";

export const PROD_DATA_DIR_NAME = ".inteligir";
export const DEV_DATA_ROOT_DIR = ".inteligir-dev";
const SQLITE_DATABASE_FILE_NAME = "inteligir.db";
const CONFIG_FILE_NAME = "config.json";
export const PROD_SERVER_PORT = 4664;

const DEV_HASH_LENGTH = 12;
const DEV_PORT_BASE = 21_000;
const DEV_PORT_BUCKETS = 8_000;

interface EnvVarDefinition<TValue> {
  description: string;
  name: string;
  parse(args: { homeDir: string; name: string; value: string }): TValue;
}

function defineEnvVar<TValue>(definition: EnvVarDefinition<TValue>): EnvVarDefinition<TValue> {
  return definition;
}

function parseDataDirValue(name: string, rawValue: string, homeDir: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/")) {
    return resolve(homeDir, trimmed.slice(2));
  }
  // Checked BEFORE any resolve(): a relative value would silently anchor to
  // whatever cwd this process happened to start in.
  if (!isAbsolute(trimmed)) {
    throw new Error(
      `${name} must be an absolute path (got "${trimmed}"). Pass an absolute path, or a ~/ path for a home-relative one.`,
    );
  }
  return resolve(trimmed);
}

function parsePortValue(name: string, rawPort: string): number {
  const port = Number(rawPort);
  if (String(port) !== rawPort || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

/** Every env var this process reads, declared exactly once. */
const ENV_VARS = {
  dataDir: defineEnvVar({
    name: "INTELIGIR_DATA_DIR",
    description:
      "Absolute (or ~-relative) data directory override; replaces both the prod and per-checkout dev defaults.",
    parse: ({ homeDir, name, value }) => parseDataDirValue(name, value, homeDir),
  }),
  port: defineEnvVar({
    name: "INTELIGIR_PORT",
    description: "TCP port for the local server.",
    parse: ({ name, value }) => parsePortValue(name, value.trim()),
  }),
};

function readEnvVar<TValue>(
  definition: EnvVarDefinition<TValue>,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): TValue | undefined {
  const rawValue = env[definition.name];
  if (rawValue === undefined) {
    return undefined;
  }
  return definition.parse({ homeDir, name: definition.name, value: rawValue });
}

/**
 * The managed config file (`<dataDir>/config.json`). Lenient on purpose:
 * unknown keys from a newer build must not brick an older one.
 */
const managedConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535).optional(),
});

function readManagedConfig(dataDir: string): z.infer<typeof managedConfigSchema> {
  let raw: string;
  try {
    raw = readFileSync(join(dataDir, CONFIG_FILE_NAME), "utf8");
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
    throw new Error(`${CONFIG_FILE_NAME} is not valid JSON`);
  }
  return managedConfigSchema.parse(parsed);
}

function createCheckoutHash(checkoutPath: string): string {
  return createHash("sha256").update(checkoutPath).digest("hex");
}

/**
 * THE dev-instance derivation, whole scheme in one place. One dev instance
 * per checkout, keyed by sha256 of the checkout path, so parallel worktrees
 * never share a database or collide on a socket:
 *
 *   data dir  = ~/.inteligir-dev/<hash truncated to 12 hex chars>
 *   port      = 21000 + (first 8 hex chars of hash % 8000)   → 21000–28999
 *
 * A derived port that turns out taken is probed upward at listen time
 * (`listen.ts`), bounded; env/managed-config ports are never probed — a
 * configured port that is busy is an error the user asked to see.
 */
export function resolveDevInstanceId(checkoutPath: string): string {
  return createCheckoutHash(checkoutPath).slice(0, DEV_HASH_LENGTH);
}

export function resolveDevDefaultPort(checkoutPath: string): number {
  const hash = createCheckoutHash(checkoutPath);
  return DEV_PORT_BASE + (Number.parseInt(hash.slice(0, 8), 16) % DEV_PORT_BUCKETS);
}

export interface AppConfig {
  databasePath: string;
  dataDir: string;
  /** "default" means derived (prod dir / per-checkout dev dir). */
  dataDirSource: "env" | "default";
  mode: RuntimeMode;
  port: number;
  /** Where the port came from; main only probes dev-derived defaults on EADDRINUSE. */
  portSource: "env" | "managed-config" | "default";
}

export interface ResolveAppConfigArgs {
  /** The running checkout (dev instance derivation); typically process.cwd(). */
  checkoutPath: string;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
}

/** Layering, per value: env var → managed config file → default. */
export function resolveAppConfig(args: ResolveAppConfigArgs): AppConfig {
  const homeDir = args.homeDir ?? homedir();
  const mode: RuntimeMode = args.env.NODE_ENV === "production" ? "prod" : "dev";

  const envDataDir = readEnvVar(ENV_VARS.dataDir, args.env, homeDir);
  const dataDir =
    envDataDir ??
    (mode === "prod"
      ? join(homeDir, PROD_DATA_DIR_NAME)
      : join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId(args.checkoutPath)));

  const managed = readManagedConfig(dataDir);

  const envPort = readEnvVar(ENV_VARS.port, args.env, homeDir);
  const port =
    envPort ??
    managed.port ??
    (mode === "prod" ? PROD_SERVER_PORT : resolveDevDefaultPort(args.checkoutPath));

  return {
    databasePath: join(dataDir, SQLITE_DATABASE_FILE_NAME),
    dataDir,
    dataDirSource: envDataDir === undefined ? "default" : "env",
    mode,
    port,
    portSource:
      envPort !== undefined ? "env" : managed.port !== undefined ? "managed-config" : "default",
  };
}
