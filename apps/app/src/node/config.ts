// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { errnoCode } from "./errno";

type RuntimeMode = "dev" | "prod";

export const PROD_DATA_DIR_NAME = ".inteligir";
export const DEV_DATA_ROOT_DIR = ".inteligir-dev";
const PROD_VAULT_DIR_NAME = "Inteligir";
// Dev instance layout: data/ and vault/ are SIBLINGS under one per-checkout
// instance dir, because the vault and the data dir must be disjoint (the
// vault is a git repo the sync loop pushes — a nested data dir would stage
// the SQLite file into it).
const DEV_INSTANCE_DATA_DIR_NAME = "data";
const DEV_INSTANCE_VAULT_DIR_NAME = "vault";
const SQLITE_DATABASE_FILE_NAME = "inteligir.db";
const CONFIG_FILE_NAME = "config.json";
export const PROD_SERVER_PORT = 4664;

const DEV_HASH_LENGTH = 12;
const DEV_PORT_BASE = 21_000;
const DEV_PORT_BUCKETS = 8_000;

/**
 * Bound for the upward probe on a busy DERIVED dev port — both halves of it:
 * `listen.ts` probes this many ports when binding, and the CLI's server
 * discovery probes the same range when dialing, so the two can never disagree
 * on where a probed instance may have landed.
 */
export const DEV_PORT_PROBE_LIMIT = 10;

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

/**
 * Git remote "URLs" include scp-like forms (git@host:path) that no URL parser
 * accepts, so validation is an allowlist of the shapes git actually dials:
 * https/ssh/git/file schemes plus scp-like user@host:path. Everything else is
 * refused — in particular anything a git invocation could parse as an OPTION
 * (a leading "-"), which no allowed shape can start with.
 */
function parseRemoteUrlValue(name: string, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (/\s/u.test(trimmed)) {
    throw new Error(`${name} must not contain whitespace`);
  }
  const hasAllowedScheme = /^(?:https|ssh|git|file):\/\/./u.test(trimmed);
  const isScpLike = /^[\w.-]+@[\w.-]+:.+$/u.test(trimmed);
  if (!hasAllowedScheme && !isScpLike) {
    throw new Error(
      `${name} must be an https://, ssh://, git://, file:// URL or user@host:path (got "${trimmed}")`,
    );
  }
  return trimmed;
}

function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * The vault is a git repo the sync loop pushes; a data dir inside it would be
 * staged and shipped (SQLite, config, secrets), and a vault inside the data
 * dir would be swept by data-dir tooling. Neither nesting has a sane meaning,
 * so the configuration is refused at boot instead of half-guarded at runtime.
 */
function assertVaultAndDataDirDisjoint(vaultDir: string, dataDir: string): void {
  const vault = resolve(vaultDir);
  const data = resolve(dataDir);
  if (pathContains(vault, data) || pathContains(data, vault)) {
    throw new Error(
      `The vault directory and the data directory must be disjoint, but vault "${vault}" and data dir "${data}" nest. ` +
        `Set INTELIGIR_VAULT_DIR (or config.json's vaultDir) to a folder outside the data dir.`,
    );
  }
}

const AGENT_MODE_VALUES = ["auto", "codex", "scripted", "off"] as const;
type AgentMode = (typeof AGENT_MODE_VALUES)[number];

function isAgentMode(value: string): value is AgentMode {
  return AGENT_MODE_VALUES.some((mode) => mode === value);
}

function parseAgentModeValue(name: string, rawValue: string): AgentMode {
  const trimmed = rawValue.trim();
  if (!isAgentMode(trimmed)) {
    throw new Error(`${name} must be one of ${AGENT_MODE_VALUES.join(", ")} (got "${trimmed}")`);
  }
  return trimmed;
}

function parseNonEmptyValue(name: string, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return trimmed;
}

function parsePortValue(name: string, rawPort: string): number {
  const port = Number(rawPort);
  if (String(port) !== rawPort || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

function parseSyncIntervalValue(name: string, rawValue: string): number {
  const trimmed = rawValue.trim();
  const value = Number(trimmed);
  if (String(value) !== trimmed || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer of milliseconds (0 disables the loop)`);
  }
  return value;
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
  vaultDir: defineEnvVar({
    name: "INTELIGIR_VAULT_DIR",
    description:
      "Absolute (or ~-relative) vault directory override; replaces both the prod (~/Inteligir) and dev (<dataDir>/vault) defaults.",
    parse: ({ homeDir, name, value }) => parseDataDirValue(name, value, homeDir),
  }),
  vaultRemote: defineEnvVar({
    name: "INTELIGIR_VAULT_REMOTE",
    description: "Git remote URL the vault syncs against; unset means local-only.",
    parse: ({ name, value }) => parseRemoteUrlValue(name, value),
  }),
  vaultSyncIntervalMs: defineEnvVar({
    name: "INTELIGIR_SYNC_INTERVAL_MS",
    description:
      "Vault auto-sync cadence in milliseconds; 0 disables the loop AND the boot sync, leaving POST /api/v1/vault/sync the only trigger (what a deterministic test harness needs). Unset means the runtime default.",
    parse: ({ name, value }) => parseSyncIntervalValue(name, value),
  }),
  devHmrPort: defineEnvVar({
    name: "INTELIGIR_HMR_PORT",
    description:
      "Dev only: the port for vite's HMR websocket (server and injected client together). Vite's default is one machine-global port (24678), so concurrent dev instances collide on it and the loser's page throws — a harness that boots several instances gives each its own.",
    parse: ({ name, value }) => parsePortValue(name, value.trim()),
  }),
  agent: defineEnvVar({
    name: "INTELIGIR_AGENT",
    description:
      "Agent provider selection: auto (codex when the binary exists), codex, scripted (in-process fake for e2e), or off.",
    parse: ({ name, value }) => parseAgentModeValue(name, value),
  }),
  agentModel: defineEnvVar({
    name: "INTELIGIR_AGENT_MODEL",
    description: "Model passed through to the agent provider; unset means the provider's default.",
    parse: ({ name, value }) => parseNonEmptyValue(name, value),
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
  vaultDir: z.string().min(1).optional(),
  vaultRemote: z.string().min(1).optional(),
  agent: z.enum(AGENT_MODE_VALUES).optional(),
  agentModel: z.string().min(1).optional(),
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
 *   instance  = ~/.inteligir-dev/<hash truncated to 12 hex chars>
 *   data dir  = <instance>/data     (vault default = <instance>/vault — siblings,
 *                                    because the two must be disjoint)
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
  /** The vault: a git repo of markdown files, created on first boot if absent. */
  vaultDir: string;
  /** null means local-only — no sync loop runs. */
  vaultRemote: string | null;
  /** Absent = the runtime's default cadence; null = disabled (explicit syncs
   *  only); a positive number = the cadence in ms. */
  vaultSyncIntervalMs?: number | null;
  /** Dev only: vite's HMR websocket port; absent = vite's default. */
  devHmrPort?: number;
  /** Which turn driver boots (issue #549); "auto" resolves at boot by binary presence. */
  agent: AgentMode;
  /** Model passed through to the provider; null means the provider's default. */
  agentModel: string | null;
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

  const devInstanceDir = join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId(args.checkoutPath));
  const envDataDir = readEnvVar(ENV_VARS.dataDir, args.env, homeDir);
  const dataDir =
    envDataDir ??
    (mode === "prod"
      ? join(homeDir, PROD_DATA_DIR_NAME)
      : join(devInstanceDir, DEV_INSTANCE_DATA_DIR_NAME));

  const managed = readManagedConfig(dataDir);

  const envPort = readEnvVar(ENV_VARS.port, args.env, homeDir);
  const port =
    envPort ??
    managed.port ??
    (mode === "prod" ? PROD_SERVER_PORT : resolveDevDefaultPort(args.checkoutPath));

  const envVaultDir = readEnvVar(ENV_VARS.vaultDir, args.env, homeDir);
  const vaultDir =
    envVaultDir ??
    (managed.vaultDir === undefined
      ? undefined
      : parseDataDirValue("config.json vaultDir", managed.vaultDir, homeDir)) ??
    (mode === "prod"
      ? join(homeDir, PROD_VAULT_DIR_NAME)
      : join(devInstanceDir, DEV_INSTANCE_VAULT_DIR_NAME));
  assertVaultAndDataDirDisjoint(vaultDir, dataDir);

  const envVaultRemote = readEnvVar(ENV_VARS.vaultRemote, args.env, homeDir);
  const vaultRemote =
    envVaultRemote ??
    (managed.vaultRemote === undefined
      ? null
      : parseRemoteUrlValue("config.json vaultRemote", managed.vaultRemote));

  const envSyncIntervalMs = readEnvVar(ENV_VARS.vaultSyncIntervalMs, args.env, homeDir);
  const envHmrPort = readEnvVar(ENV_VARS.devHmrPort, args.env, homeDir);
  const agent = readEnvVar(ENV_VARS.agent, args.env, homeDir) ?? managed.agent ?? "auto";
  const agentModel =
    readEnvVar(ENV_VARS.agentModel, args.env, homeDir) ?? managed.agentModel ?? null;

  return {
    ...(envHmrPort === undefined ? {} : { devHmrPort: envHmrPort }),
    ...(envSyncIntervalMs === undefined
      ? {}
      : { vaultSyncIntervalMs: envSyncIntervalMs === 0 ? null : envSyncIntervalMs }),
    databasePath: join(dataDir, SQLITE_DATABASE_FILE_NAME),
    dataDir,
    dataDirSource: envDataDir === undefined ? "default" : "env",
    mode,
    port,
    portSource:
      envPort !== undefined ? "env" : managed.port !== undefined ? "managed-config" : "default",
    vaultDir,
    vaultRemote,
    agent,
    agentModel,
  };
}
