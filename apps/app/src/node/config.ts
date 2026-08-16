// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// bb's env-vars + runtime data-dir scheme, simplified: one file, two env
// vars, and the per-checkout instance id hashes the process cwd (bb hashes a
// supervisor-provided repo root; this process has no supervisor).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

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

function expandHomeDirectory(pathValue: string, homeDir: string): string {
  if (pathValue === "~") {
    return homeDir;
  }
  if (pathValue.startsWith("~/")) {
    return resolve(homeDir, pathValue.slice(2));
  }
  return resolve(pathValue);
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
    parse: ({ homeDir, name, value }) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error(`${name} must not be empty`);
      }
      const expanded = expandHomeDirectory(trimmed, homeDir);
      if (!isAbsolute(expanded)) {
        throw new Error(`${name} must resolve to an absolute path`);
      }
      return expanded;
    },
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
    const errorCode = error instanceof Error && "code" in error ? error.code : undefined;
    if (errorCode === "ENOENT") {
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
 * One dev instance per checkout: parallel worktrees each get their own data
 * dir and default port, so two `pnpm dev`s never share a database or collide
 * on a socket.
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
  mode: RuntimeMode;
  port: number;
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

  const dataDir =
    readEnvVar(ENV_VARS.dataDir, args.env, homeDir) ??
    (mode === "prod"
      ? join(homeDir, PROD_DATA_DIR_NAME)
      : join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId(args.checkoutPath)));

  const managed = readManagedConfig(dataDir);

  const port =
    readEnvVar(ENV_VARS.port, args.env, homeDir) ??
    managed.port ??
    (mode === "prod" ? PROD_SERVER_PORT : resolveDevDefaultPort(args.checkoutPath));

  return {
    databasePath: join(dataDir, SQLITE_DATABASE_FILE_NAME),
    dataDir,
    mode,
    port,
  };
}
