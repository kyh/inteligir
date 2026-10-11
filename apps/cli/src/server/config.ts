// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { HarnessId, HarnessModels } from "@repo/agent-runtime/acp/harness-registry";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";
import { agentModeSchema, agentModeValues } from "@repo/contract/local/system/system-schema";
import type { AgentMode } from "@repo/contract/local/system/system-schema";
import { parseRemoteUrl, VAULT_REMOTE_PIN_ENV_VAR } from "@repo/contract/local/vault/remote-url";
import { DEBUG_NAMESPACES, parseDebugNamespaces } from "./debug-log";
import type { DebugNamespace } from "./debug-log";
import { resolveDevDefaultPort, resolveDevInstanceId } from "./dev-instance";
import { errnoCode } from "./errno";
import { assertVaultAndDataDirDisjoint } from "./path-containment";
import { stagedWriteFileSync } from "./staged-write";
import type { SlowReads } from "./vault/slow-reads";

type RuntimeMode = "dev" | "prod";

export const PROD_DATA_DIR_NAME = ".inteligir";
export const DATA_DIR_ENV_VAR = "INTELIGIR_DATA_DIR";
export const DEV_DATA_ROOT_DIR = ".inteligir-dev";
const PROD_VAULT_DIR_NAME = "Inteligir";
// siblings, not nested: the vault is a git repo the sync loop pushes, and a nested data dir
// would stage the sqlite file into it.
const DEV_INSTANCE_DATA_DIR_NAME = "data";
const DEV_INSTANCE_VAULT_DIR_NAME = "vault";
const SQLITE_DATABASE_FILE_NAME = "inteligir.db";
export const CONFIG_FILE_NAME = "config.json";
export const PROD_SERVER_PORT = 4664;
export const VAULTS_DIR_NAME = "vaults";
const VAULT_DATA_DIR_HASH_LENGTH = 16;

// the native realpath, or null for a path that is not there
export type Realpath = (target: string) => string | null;

export const nativeRealpath: Realpath = (target) => {
  try {
    return realpathSync.native(target);
  } catch {
    return null;
  }
};

// A folder's identity: every symlink followed, through the nearest ancestor that exists for a
// folder not made yet, so a vault has one spelling before its first boot and after it. The native
// realpath rather than the JS one, because only it answers a case-insensitive volume's own case
// (`~/inteligir` is `~/Inteligir`); a tail not made yet keeps the case it was given.
export const physicalVaultDir = (dir: string, realpath: Realpath = nativeRealpath): string => {
  const missing: string[] = [];
  let current = path.resolve(dir);
  for (;;) {
    const real = realpath(current);
    if (real !== null) {
      return path.join(real, ...missing.toReversed());
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(dir);
    }
    missing.push(path.basename(current));
    current = parent;
  }
};

// Every vault gets a dir of its own beneath the root, so two vaults never share an index, a db or
// a server.json. Keyed by the folder's physical path, so every spelling the disk resolves to one
// folder is one vault with one data dir.
export const vaultDataDir = (rootDataDir: string, vaultDir: string): string => {
  const digest = createHash("sha256").update(physicalVaultDir(vaultDir)).digest("hex");
  return path.join(rootDataDir, VAULTS_DIR_NAME, digest.slice(0, VAULT_DATA_DIR_HASH_LENGTH));
};

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

const parseRemoteUrlValue = (name: string, rawValue: string): string => {
  const verdict = parseRemoteUrl(rawValue);
  if (!verdict.ok) {
    throw new Error(`${name} ${verdict.reason}`);
  }
  return verdict.url;
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

// `<ms>:<vault path>`, split at the first colon, since a path may hold one and a count never does.
const parseSlowReadsValue = (name: string, rawValue: string): SlowReads => {
  const trimmed = rawValue.trim();
  const colon = trimmed.indexOf(":");
  const rawDelay = colon === -1 ? trimmed : trimmed.slice(0, colon);
  const delayMs = Number(rawDelay);
  if (colon === -1 || String(delayMs) !== rawDelay || !Number.isInteger(delayMs) || delayMs <= 0) {
    throw new Error(
      `${name} must be <milliseconds>:<vault path>, an empty path naming the whole vault (got "${trimmed}")`,
    );
  }
  return { delayMs, path: trimmed.slice(colon + 1) };
};

const parseNonEmptyValue = (name: string, rawValue: string): string => {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return trimmed;
};

// shared with serve's --port, so the flag accepts exactly what INTELIGIR_PORT does.
export const parsePortValue = (name: string, rawPort: string): number => {
  const port = Number(rawPort);
  if (String(port) !== rawPort || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
};

const parseSyncIntervalValue = (name: string, rawValue: string): number => {
  const trimmed = rawValue.trim();
  const value = Number(trimmed);
  if (String(value) !== trimmed || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer of milliseconds (0 disables the loop)`);
  }
  return value;
};

const ENV_VARS = {
  agent: defineEnvVar({
    description:
      "Agent runtime selection: auto (the ACP runtime, over the vendor binaries bundled with the adapters; PATH is never consulted), scripted (in-process fake for e2e), or off. WHICH harness runs is a thread's own providerId, never this.",
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
    description: `Comma-separated diagnostics written to stderr (${DEBUG_NAMESPACES.join(", ")}): the decisions each makes, by path and id, never note content or a credential. Unset means none.`,
    name: "INTELIGIR_DEBUG",
    parse: ({ name, value }) => parseDebugNamespaces(name, value),
  }),
  port: defineEnvVar({
    description: "TCP port for the local server.",
    name: "INTELIGIR_PORT",
    parse: ({ name, value }) => parsePortValue(name, value.trim()),
  }),
  vaultDir: defineEnvVar({
    description:
      "Absolute (or ~-relative) vault directory override; replaces both the prod (~/Inteligir) and dev (<dataDir>/vault) defaults.",
    name: "INTELIGIR_VAULT_DIR",
    parse: ({ homeDir, name, value }) => parseDataDirValue(name, value, homeDir),
  }),
  vaultRemote: defineEnvVar({
    description:
      "Git remote URL the vault syncs against, pinned over the vault's own origin. Unset, the vault's own origin decides; with none, a SIGNED-IN install derives the hosted remote from its device credential unless another service (iCloud Drive, Dropbox, Google Drive, OneDrive, Obsidian Sync) already syncs the folder; unset, signed out and with no origin means local-only.",
    name: VAULT_REMOTE_PIN_ENV_VAR,
    parse: ({ name, value }) => parseRemoteUrlValue(name, value),
  }),
  slowReads: defineEnvVar({
    description:
      "Delays every vault read of one path and everything under it by some milliseconds, as `<ms>:<vault path>`; an empty path is the whole vault. A stand-in for storage that answers an open late, for e2e.",
    name: "INTELIGIR_SLOW_READS",
    parse: ({ name, value }) => parseSlowReadsValue(name, value),
  }),
  vaultSyncIntervalMs: defineEnvVar({
    description:
      "Vault auto-sync cadence in milliseconds; 0 disables the loop AND the boot sync, leaving the vault.syncNow procedure the only trigger (what a deterministic test harness needs). Unset means the runtime default.",
    name: "INTELIGIR_SYNC_INTERVAL_MS",
    parse: ({ name, value }) => parseSyncIntervalValue(name, value),
  }),
};

// one row per harness, since a model id is vendor-specific: one string handed to every adapter
// would give codex a claude model. keyed by HarnessId, so a new harness cannot compile without
// its row.
const MODEL_ENV_VARS = {
  claude: defineEnvVar({
    description: "Model the Claude Code harness runs; unset means Claude Code's own default.",
    name: "INTELIGIR_CLAUDE_MODEL",
    parse: ({ name, value }) => parseNonEmptyValue(name, value),
  }),
  codex: defineEnvVar({
    description: "Model the Codex harness runs; unset means Codex's own default.",
    name: "INTELIGIR_CODEX_MODEL",
    parse: ({ name, value }) => parseNonEmptyValue(name, value),
  }),
} satisfies Record<HarnessId, EnvVarDefinition<string>>;

// apps/desktop/turbo.json's dev.passThroughEnv must name exactly these: turbo strips anything
// unnamed in strict env mode, so a missing one is silently ignored under `pnpm dev`.
export const ENV_VAR_NAMES: readonly string[] = [
  ...Object.values(ENV_VARS),
  ...Object.values(MODEL_ENV_VARS),
]
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

// unknown keys are stripped, not refused: the window edits nothing here but the vault selector, so
// a refused key would be a boot nothing in the app repairs.
const managedConfigSchema = z.object({
  agent: agentModeSchema.optional(),
  agentModels: z
    .object({
      claude: z.string().min(1).optional(),
      codex: z.string().min(1).optional(),
    } satisfies Record<HarnessId, z.ZodOptional<z.ZodString>>)
    .optional(),
  cloudUrl: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  vaultDir: z.string().min(1).optional(),
});

// the file as its bytes name it, unknown keys included: a rewrite must carry a newer build's keys through
const managedConfigFileSchema = managedConfigSchema.loose();

const readManagedConfigFile = (dataDir: string): z.infer<typeof managedConfigFileSchema> => {
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
  const verdict = managedConfigFileSchema.safeParse(parsed);
  if (!verdict.success) {
    throw new Error(
      `${configPath} does not match the ${CONFIG_FILE_NAME} shape:\n${z.prettifyError(verdict.error)}`,
    );
  }
  return verdict.data;
};

type ManagedConfig = z.infer<typeof managedConfigSchema>;

// the selector as config.json holds it, unparsed, so writing it back restores exactly it
export const readManagedVaultDir = (rootDataDir: string): string | null =>
  readManagedConfigFile(rootDataDir).vaultDir ?? null;

// The root's config.json is the vault selector: it is what `inteligir serve` reads with no
// shell around, so a switch made in the shell is the CLI's next boot too. null removes the key, so
// the next boot is on the default vault again: a first run whose boot failed must not leave the
// next launch opening the folder that failed.
export const writeManagedVaultDir = (rootDataDir: string, vaultDir: string | null): void => {
  const current = readManagedConfigFile(rootDataDir);
  const kept = Object.fromEntries(Object.entries(current).filter(([key]) => key !== "vaultDir"));
  stagedWriteFileSync(
    path.join(rootDataDir, CONFIG_FILE_NAME),
    `${JSON.stringify(vaultDir === null ? kept : { ...kept, vaultDir }, null, 2)}\n`,
  );
};

export type ConfigSource = "env" | "managed-config" | "default";
export type VaultDirSource = ConfigSource;

export interface AppConfig {
  databasePath: string;
  dataDir: string;
  dataDirSource: "env" | "default";
  // where config.json lives; `dataDir` sits beneath it unless the env pins it
  rootDataDir: string;
  // what `~/` resolved against, and where the boot looks for a service syncing the vault's folder
  homeDir: string;
  mode: RuntimeMode;
  port: number;
  portSource: ConfigSource;
  vaultDir: string;
  vaultDirSource: VaultDirSource;
  // the INTELIGIR_VAULT_REMOTE pin. null is not local-only: the vault's own origin, else a
  // signed-in install's hosted remote, is decided per pass.
  vaultRemote: string | null;
  // absent = runtime default, null = disabled, number = ms.
  vaultSyncIntervalMs?: number | null;
  // null outside the scenario suite
  slowReads: SlowReads | null;
  agent: AgentMode;
  agentModels: HarnessModels;
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

interface ResolvedVaultDir {
  vaultDir: string;
  vaultDirSource: VaultDirSource;
}

const resolveVaultDir = (
  args: ResolveAppConfigArgs,
  homeDir: string,
  mode: RuntimeMode,
  devInstanceDir: string,
  managed: ManagedConfig,
): ResolvedVaultDir => {
  const envVaultDir = readEnvVar(ENV_VARS.vaultDir, args.env, homeDir);
  const managedVaultDir =
    managed.vaultDir === undefined
      ? undefined
      : parseDataDirValue("config.json vaultDir", managed.vaultDir, homeDir);
  const defaultVaultDir =
    mode === "prod"
      ? path.join(homeDir, PROD_VAULT_DIR_NAME)
      : path.join(devInstanceDir, DEV_INSTANCE_VAULT_DIR_NAME);
  return {
    vaultDir: envVaultDir ?? managedVaultDir ?? defaultVaultDir,
    vaultDirSource: configSource(envVaultDir, managedVaultDir),
  };
};

const resolveAgentModels = (
  args: ResolveAppConfigArgs,
  homeDir: string,
  managed: ManagedConfig,
): HarnessModels => ({
  claude:
    readEnvVar(MODEL_ENV_VARS.claude, args.env, homeDir) ?? managed.agentModels?.claude ?? null,
  codex: readEnvVar(MODEL_ENV_VARS.codex, args.env, homeDir) ?? managed.agentModels?.codex ?? null,
});

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

  const devInstanceDir = path.join(
    homeDir,
    DEV_DATA_ROOT_DIR,
    resolveDevInstanceId(args.checkoutPath),
  );
  const envDataDir = readEnvVar(ENV_VARS.dataDir, args.env, homeDir);
  const rootDataDir =
    envDataDir ??
    (mode === "prod"
      ? path.join(homeDir, PROD_DATA_DIR_NAME)
      : path.join(devInstanceDir, DEV_INSTANCE_DATA_DIR_NAME));

  const managed = managedConfigSchema.parse(readManagedConfigFile(rootDataDir));

  const envPort = readEnvVar(ENV_VARS.port, args.env, homeDir);
  const port =
    envPort ??
    managed.port ??
    (mode === "prod" ? PROD_SERVER_PORT : resolveDevDefaultPort(args.checkoutPath));

  const { vaultDir, vaultDirSource } = resolveVaultDir(
    args,
    homeDir,
    mode,
    devInstanceDir,
    managed,
  );
  // an explicit data dir is taken as given: a harness, an operator or the shell pinned it and
  // expects exactly it
  const dataDir = envDataDir ?? vaultDataDir(rootDataDir, vaultDir);
  // the data dir is the root or beneath it, so this one check covers both: a vault under the root
  // would sit beside config.json and every vault's db
  assertVaultAndDataDirDisjoint(path.resolve(vaultDir), path.resolve(rootDataDir));

  const vaultRemote = readEnvVar(ENV_VARS.vaultRemote, args.env, homeDir) ?? null;
  const envSyncIntervalMs = readEnvVar(ENV_VARS.vaultSyncIntervalMs, args.env, homeDir);
  const slowReads = readEnvVar(ENV_VARS.slowReads, args.env, homeDir) ?? null;
  const agent = readEnvVar(ENV_VARS.agent, args.env, homeDir) ?? managed.agent ?? "auto";
  const agentModels = resolveAgentModels(args, homeDir, managed);
  const cloudUrl = resolveCloudUrl(args, homeDir, managed);
  const debug = readEnvVar(ENV_VARS.debug, args.env, homeDir) ?? new Set();

  const config: AppConfig = {
    agent,
    agentModels,
    cloudUrl,
    debug,
    dataDir,
    dataDirSource: envDataDir === undefined ? "default" : "env",
    databasePath: path.join(dataDir, SQLITE_DATABASE_FILE_NAME),
    homeDir,
    mode,
    port,
    portSource: configSource(envPort, managed.port),
    rootDataDir,
    slowReads,
    vaultDir,
    vaultDirSource,
    vaultRemote,
  };
  if (envSyncIntervalMs !== undefined) {
    config.vaultSyncIntervalMs = envSyncIntervalMs === 0 ? null : envSyncIntervalMs;
  }
  return config;
};
