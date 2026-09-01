// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

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
/** Under the PROD data dir in both modes — see `AppConfig.modelDir`. */
const MODELS_DIR_NAME = "models";
/** The managed config layer, in the data dir. Exported because it is WRITTEN
 *  from outside this program — a file whose name only its reader knows is a
 *  file a writer spells wrong once and never notices. */
export const CONFIG_FILE_NAME = "config.json";
export const PROD_SERVER_PORT = 4664;

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

/**
 * The hosted deployment this install pairs against. Configurable rather than
 * compiled in, because the local loop needs to point at a miniflare origin and
 * a self-hosted Worker is the same shape — but it has a DEFAULT, because a
 * value every ordinary install would have to set is a value that belongs in
 * the code.
 */
export const DEFAULT_CLOUD_URL = "https://inteligir.com";

/** Origin only: the paths are `@repo/api/cloud`'s, and a base carrying a
 *  path would silently truncate them (`new URL("/v1/…", base)` drops it). */
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

/** Exported because `serve`'s `--port` must accept exactly what
 *  `INTELIGIR_PORT` does — the flag resolves to that variable, so two
 *  predicates would be a value the flag takes and the boot then refuses. */
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
    description:
      "Git remote URL the vault syncs against. Unset, a PAIRED install derives the hosted remote from its device credential; unset and unpaired means local-only.",
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
    description: `Origin of the hosted deployment this install pairs against for thread sync; unset means ${DEFAULT_CLOUD_URL}. Pairing is what turns sync on — an unpaired install opens no socket and makes no request whatever this says.`,
    parse: ({ name, value }) => parseCloudUrlValue(name, value),
  }),
};

/**
 * Every variable the table above declares, DERIVED from it rather than
 * retyped. `apps/desktop/turbo.json`'s `dev.passThroughEnv` must name exactly
 * these: turbo runs in strict env mode and strips anything unnamed, so a
 * variable declared here and missing there is silently IGNORED through the
 * root `pnpm dev` rather than refused — the failure mode has no error message
 * at all. `tools/repo-guards/src/turbo-passthrough.test.ts` holds the two
 * against each other.
 */
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

/**
 * The managed config file (`<dataDir>/config.json`). Lenient on purpose:
 * unknown keys from a newer build must not brick an older one.
 */
const managedConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535).optional(),
  vaultDir: z.string().min(1).optional(),
  vaultRemote: z.string().min(1).optional(),
  agent: agentModeSchema.optional(),
  agentModel: z.string().min(1).optional(),
  cloudUrl: z.string().min(1).optional(),
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
  /** The EXPLICIT remote (env/config.json), or null when none is set — in
   *  which case a paired install still derives the hosted one per pass
   *  (cloud/vault-remote.ts); truly local-only means null here AND unpaired. */
  vaultRemote: string | null;
  /** Absent = the runtime's default cadence; null = disabled (explicit syncs
   *  only); a positive number = the cadence in ms. */
  vaultSyncIntervalMs?: number | null;
  /**
   * Where downloaded models live (issue #574). NOT under the data dir: a model
   * is a cache of the network keyed by its own id, so every checkout on this
   * machine shares one copy rather than each paying the download.
   */
  modelDir: string;
  /** Which transcription runtime dictation uses; "scripted" is the e2e fake. */
  voice: VoiceMode;
  /** Which turn driver boots; "auto" resolves at boot by binary presence. */
  agent: AgentMode;
  /** Model passed through to the provider; null means the provider's default. */
  agentModel: string | null;
  /** Origin of the hosted deployment cloud sync pairs against (issue #572).
   *  Says WHERE, never WHETHER — the credential in the data dir is the switch. */
  cloudUrl: string;
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
    mode,
    port,
    portSource:
      envPort !== undefined ? "env" : managed.port !== undefined ? "managed-config" : "default",
    vaultDir,
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
