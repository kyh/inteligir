// ---------------------------------------------------------------------------
// The saved desktop environment — the pairing outcome the app keeps so it can
// reconnect without re-pairing. PURE: storage is an injected string port
// (production binds expo-secure-store in expo-environment-store.ts; tests use
// an in-memory map). Persisted as a versioned `{ environments: [...] }`
// envelope even though only one environment exists today, so growing to a
// list later is a read-compatible evolution, not a migration. Corrupt or
// legacy payloads read as "no environment" — never a throw.
// ---------------------------------------------------------------------------

import { isRecord } from "@repo/bridge/wire-helpers";

/** A desktop the device has paired with: where to connect + the durable
 * device credential the ws host minted for us. */
export type KnownEnvironment = {
  /** Display name — the desktop's hostname/address as parsed at pair time. */
  readonly name: string;
  /** `ws://<addr>:<port>` of the desktop's ws transport. */
  readonly wsUrl: string;
  /** Our identity in the desktop's paired-device store. */
  readonly deviceId: string;
  /** The durable auth token presented on every connect. Secret. */
  readonly deviceToken: string;
};

/** The tiny storage seam: production is expo-secure-store, tests a Map.
 * Delete is fire-and-forget (SecureStore only deletes async). */
export type StringStorePort = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
};

export type EnvironmentStore = {
  /** The saved environment, or null when unpaired / unreadable. */
  get(): KnownEnvironment | null;
  /** Save (replacing any previous environment — single-environment for now). */
  save(env: KnownEnvironment): void;
  /** Forget the saved environment (un-pair locally). */
  clear(): void;
};

const STORE_KEY = "inteligir.hostEnvironments";
const STORE_VERSION = 1;

function parseEnvironment(value: unknown): KnownEnvironment | null {
  if (!isRecord(value)) return null;
  const { name, wsUrl, deviceId, deviceToken } = value;
  return typeof name === "string" &&
    typeof wsUrl === "string" &&
    typeof deviceId === "string" &&
    typeof deviceToken === "string"
    ? { name, wsUrl, deviceId, deviceToken }
    : null;
}

/** Parse the stored envelope into its environments; anything malformed
 * (bad JSON, wrong version, non-array) is an empty list, never a throw. */
function parseStored(text: string): KnownEnvironment[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(raw) || raw["version"] !== STORE_VERSION) return [];
  const list = raw["environments"];
  if (!Array.isArray(list)) return [];
  const environments: KnownEnvironment[] = [];
  for (const entry of list) {
    const env = parseEnvironment(entry);
    if (env !== null) environments.push(env);
  }
  return environments;
}

export function createEnvironmentStore(port: StringStorePort): EnvironmentStore {
  return {
    get: () => {
      const text = port.get(STORE_KEY);
      if (text === null) return null;
      return parseStored(text)[0] ?? null;
    },
    save: (env) => {
      port.set(STORE_KEY, JSON.stringify({ version: STORE_VERSION, environments: [env] }));
    },
    clear: () => {
      port.delete(STORE_KEY);
    },
  };
}
