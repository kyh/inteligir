// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  agentModeSchema,
  agentModeValues,
  type AgentMode,
} from "@repo/api/local/system/system-schema";
import { resolveDevDefaultPort, resolveDevInstanceId } from "./dev-instance";
import { errnoCode } from "./errno";
import { assertModelDirOutsideVault, assertVaultAndDataDirDisjoint } from "./path-containment";
import { stagedWriteFileSync } from "./staged-write";

type RuntimeMode = "dev" | "prod";

export const PROD_DATA_DIR_NAME = ".inteligir";
export const DEV_DATA_ROOT_DIR = ".inteligir-dev";
const PROD_VAULT_DIR_NAME = "Inteligir";
// siblings, not nested: the vault is a git repo the sync loop pushes, and a nested data dir
// would stage the sqlite file into it.
const DEV_INSTANCE_DATA_DIR_NAME = "data";
const DEV_INSTANCE_VAULT_DIR_NAME = "vault";
const SQLITE_DATABASE_FILE_NAME = "inteligir.db";
const MODELS_DIR_NAME = "models";
export const CONFIG_FILE_NAME = "config.json";
export const PROD_SERVER_PORT = 4664;
export const VAULTS_DIR_NAME = "vaults";
const VAULT_DATA_DIR_HASH_LENGTH = 16;

// The default vault keeps the root, as every install before a second vault did; any other
// vault gets a dir of its own beneath it, so two vaults never share an index, a db or a
// server.json. Keyed by the resolved path, not a realpath: the vault may not exist yet.
export function vaultDataDir(rootDataDir: string, vaultDir: string): string {
  const digest = createHash("sha256").update(resolve(vaultDir)).digest("hex");
  return join(rootDataDir, VAULTS_DIR_NAME, digest.slice(0, VAULT_DATA_DIR_HASH_LENGTH));
}

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
  // before resolve(): a relative value would anchor to whatever cwd the process started in.
  if (!isAbsolute(trimmed)) {
    throw new Error(
      `${name} must be an absolute path (got "${trimmed}"). Pass an absolute path, or a ~/ path for a home-relative one.`,
    );
  }
  return resolve(trimmed);
}

// git remotes include scp-like `git@host:path`, which no url parser accepts, so this is an
// allowlist of the shapes git dials; none can start with "-", which git would parse as an option.
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

export const DEFAULT_CLOUD_URL = "https://inteligir.com";

// origin only: `new URL("/v1/…", base)` drops any path the base carries.
function parseCloudUrlValue(name: string, rawValue: string): string {
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
}

function parseAgentModeValue(name: string, rawValue: string): AgentMode {
  const parsed = agentModeSchema.safeParse(rawValue.trim());
  if (!parsed.success) {
    throw new Error(
      `${name} must be one of ${agentModeValues.join(", ")} (got "${rawValue.trim()}")`,
    );
  }
  return parsed.data;
}

const VOICE_MODE_VALUES = ["auto", "scripted"] as const;
type VoiceMode = (typeof VOICE_MODE_VALUES)[number];

function isVoiceMode(value: string): value is VoiceMode {
  return VOICE_MODE_VALUES.some((mode) => mode === value);
}

function parseVoiceModeValue(name: string, rawValue: string): VoiceMode {
  const trimmed = rawValue.trim();
  if (!isVoiceMode(trimmed)) {
    throw new Error(`${name} must be one of ${VOICE_MODE_VALUES.join(", ")} (got "${trimmed}")`);
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

// shared with serve's --port, so the flag accepts exactly what INTELIGIR_PORT does.
export function parsePortValue(name: string, rawPort: string): number {
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
    description:
      "Git remote URL the vault syncs against. Unset, a SIGNED-IN install derives the hosted remote from its device credential; unset and signed out means local-only.",
    parse: ({ name, value }) => parseRemoteUrlValue(name, value),
  }),
  vaultSyncIntervalMs: defineEnvVar({
    name: "INTELIGIR_SYNC_INTERVAL_MS",
    description:
      "Vault auto-sync cadence in milliseconds; 0 disables the loop AND the boot sync, leaving the vault.syncNow procedure the only trigger (what a deterministic test harness needs). Unset means the runtime default.",
    parse: ({ name, value }) => parseSyncIntervalValue(name, value),
  }),
  agent: defineEnvVar({
    name: "INTELIGIR_AGENT",
    description:
      "Agent runtime selection: auto (the ACP runtime when a vendor CLI is on PATH), scripted (in-process fake for e2e), or off. WHICH harness runs is a thread's own providerId, never this.",
    parse: ({ name, value }) => parseAgentModeValue(name, value),
  }),
  agentModel: defineEnvVar({
    name: "INTELIGIR_AGENT_MODEL",
    description: "Model passed through to the agent provider; unset means the provider's default.",
    parse: ({ name, value }) => parseNonEmptyValue(name, value),
  }),
  modelDir: defineEnvVar({
    name: "INTELIGIR_MODEL_DIR",
    description:
      "Absolute (or ~-relative) directory the downloaded local models live in; unset means ~/.inteligir/models. Shared across checkouts on purpose — a model is a cache of the NETWORK, immutable and named by its id, so duplicating it per dev instance costs a re-download and buys nothing.",
    parse: ({ homeDir, name, value }) => parseDataDirValue(name, value, homeDir),
  }),
  voice: defineEnvVar({
    name: "INTELIGIR_VOICE",
    description:
      "Dictation runtime: auto (streaming Parakeet via sherpa-onnx against a downloaded model) or scripted (an in-process fake that needs neither, for e2e).",
    parse: ({ name, value }) => parseVoiceModeValue(name, value),
  }),
  cloudUrl: defineEnvVar({
    name: "INTELIGIR_CLOUD_URL",
    description: `Origin of the hosted deployment this install signs in to for thread sync; unset means ${DEFAULT_CLOUD_URL}. Signing in is what turns sync on — an install with no device credential opens no socket and makes no request whatever this says.`,
    parse: ({ name, value }) => parseCloudUrlValue(name, value),
  }),
};

// apps/desktop/turbo.json's dev.passThroughEnv must name exactly these: turbo strips anything
// unnamed in strict env mode, so a missing one is silently ignored under `pnpm dev`.
export const ENV_VAR_NAMES: readonly string[] = Object.values(ENV_VARS)
  .map((definition) => definition.name)
  .toSorted();

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

// lenient: unknown keys from a newer build must not brick an older one.
const managedConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535).optional(),
  vaultDir: z.string().min(1).optional(),
  vaultRemote: z.string().min(1).optional(),
  agent: agentModeSchema.optional(),
  agentModel: z.string().min(1).optional(),
  cloudUrl: z.string().min(1).optional(),
});

// the file as its bytes name it, unknown keys included: a rewrite must carry a newer build's keys through
const managedConfigFileSchema = managedConfigSchema.loose();

function readManagedConfigFile(dataDir: string): z.infer<typeof managedConfigFileSchema> {
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
  return managedConfigFileSchema.parse(parsed);
}

function readManagedConfig(dataDir: string): z.infer<typeof managedConfigSchema> {
  return managedConfigSchema.parse(readManagedConfigFile(dataDir));
}

// The root's config.json is the vault selector: it is what `inteligir serve` reads with no
// shell around, so a switch made in the shell is the CLI's next boot too.
export function writeManagedVaultDir(rootDataDir: string, vaultDir: string): void {
  const current = readManagedConfigFile(rootDataDir);
  stagedWriteFileSync(
    join(rootDataDir, CONFIG_FILE_NAME),
    `${JSON.stringify({ ...current, vaultDir }, null, 2)}\n`,
  );
}

export type VaultDirSource = "env" | "managed-config" | "default";

export interface AppConfig {
  databasePath: string;
  dataDir: string;
  dataDirSource: "env" | "default";
  // where config.json lives and where the default vault's data is; `dataDir` sits beneath it for any other vault
  rootDataDir: string;
  mode: RuntimeMode;
  port: number;
  portSource: "env" | "managed-config" | "default";
  vaultDir: string;
  vaultDirSource: VaultDirSource;
  // null is not local-only: a signed-in install still derives the hosted remote per pass.
  vaultRemote: string | null;
  // absent = runtime default, null = disabled, number = ms.
  vaultSyncIntervalMs?: number | null;
  // under the prod data dir in both modes: a model is a network cache keyed by id, so checkouts share one copy.
  modelDir: string;
  voice: VoiceMode;
  agent: AgentMode;
  agentModel: string | null;
  cloudUrl: string;
}

export interface ResolveAppConfigArgs {
  checkoutPath: string;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function resolveAppConfig(args: ResolveAppConfigArgs): AppConfig {
  const homeDir = args.homeDir ?? homedir();
  const mode: RuntimeMode = args.env.NODE_ENV === "production" ? "prod" : "dev";

  const devInstanceDir = join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId(args.checkoutPath));
  const envDataDir = readEnvVar(ENV_VARS.dataDir, args.env, homeDir);
  const rootDataDir =
    envDataDir ??
    (mode === "prod"
      ? join(homeDir, PROD_DATA_DIR_NAME)
      : join(devInstanceDir, DEV_INSTANCE_DATA_DIR_NAME));

  const managed = readManagedConfig(rootDataDir);

  const envPort = readEnvVar(ENV_VARS.port, args.env, homeDir);
  const port =
    envPort ??
    managed.port ??
    (mode === "prod" ? PROD_SERVER_PORT : resolveDevDefaultPort(args.checkoutPath));

  const envVaultDir = readEnvVar(ENV_VARS.vaultDir, args.env, homeDir);
  const managedVaultDir =
    managed.vaultDir === undefined
      ? undefined
      : parseDataDirValue("config.json vaultDir", managed.vaultDir, homeDir);
  const defaultVaultDir =
    mode === "prod"
      ? join(homeDir, PROD_VAULT_DIR_NAME)
      : join(devInstanceDir, DEV_INSTANCE_VAULT_DIR_NAME);
  const vaultDir = envVaultDir ?? managedVaultDir ?? defaultVaultDir;
  const vaultDirSource: VaultDirSource =
    envVaultDir !== undefined
      ? "env"
      : managedVaultDir !== undefined
        ? "managed-config"
        : "default";
  // an explicit data dir is taken as given: a harness or an operator pinned it and expects exactly it
  const dataDir =
    envDataDir !== undefined || resolve(vaultDir) === resolve(defaultVaultDir)
      ? rootDataDir
      : vaultDataDir(rootDataDir, vaultDir);
  // the root too: a vault under it would sit beside config.json and every other vault's db
  assertVaultAndDataDirDisjoint(resolve(vaultDir), resolve(rootDataDir));
  assertVaultAndDataDirDisjoint(resolve(vaultDir), resolve(dataDir));

  const envVaultRemote = readEnvVar(ENV_VARS.vaultRemote, args.env, homeDir);
  const vaultRemote =
    envVaultRemote ??
    (managed.vaultRemote === undefined
      ? null
      : parseRemoteUrlValue("config.json vaultRemote", managed.vaultRemote));

  const envSyncIntervalMs = readEnvVar(ENV_VARS.vaultSyncIntervalMs, args.env, homeDir);
  const modelDir =
    readEnvVar(ENV_VARS.modelDir, args.env, homeDir) ??
    join(homeDir, PROD_DATA_DIR_NAME, MODELS_DIR_NAME);
  assertModelDirOutsideVault(resolve(modelDir), resolve(vaultDir));
  const voice = readEnvVar(ENV_VARS.voice, args.env, homeDir) ?? "auto";
  const agent = readEnvVar(ENV_VARS.agent, args.env, homeDir) ?? managed.agent ?? "auto";
  const agentModel =
    readEnvVar(ENV_VARS.agentModel, args.env, homeDir) ?? managed.agentModel ?? null;
  const cloudUrl =
    readEnvVar(ENV_VARS.cloudUrl, args.env, homeDir) ??
    (managed.cloudUrl === undefined
      ? DEFAULT_CLOUD_URL
      : parseCloudUrlValue("config.json cloudUrl", managed.cloudUrl));

  const config: AppConfig = {
    databasePath: join(dataDir, SQLITE_DATABASE_FILE_NAME),
    dataDir,
    dataDirSource: envDataDir === undefined ? "default" : "env",
    rootDataDir,
    mode,
    port,
    portSource:
      envPort !== undefined ? "env" : managed.port !== undefined ? "managed-config" : "default",
    vaultDir,
    vaultDirSource,
    vaultRemote,
    modelDir,
    voice,
    agent,
    agentModel,
    cloudUrl,
  };
  if (envSyncIntervalMs !== undefined) {
    config.vaultSyncIntervalMs = envSyncIntervalMs === 0 ? null : envSyncIntervalMs;
  }
  return config;
}
