// ---------------------------------------------------------------------------
// Provider-config store — WHICH AI provider+model the agent surfaces run on,
// persisted at ~/.inteligir/provider-config.json. Selection only, NEVER a
// secret: credentials live in pi's auth.json (on-device, pi-owned). The store
// is deliberately dumb strings — validation/normalization against the
// catalog happens at the read boundary (provider-service), so a stale value
// heals instead of wedging boot.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

import {
  JsonStore,
  inteligirPath,
  rejectLegacyVersion,
  type FsAdapter,
} from "@repo/storage/json-store";
import { DEFAULT_PROVIDER } from "./provider-catalog";

const PROVIDER_CONFIG_VERSION = 1;

const ProviderConfigSchema = Type.Object(
  {
    version: Type.Literal(PROVIDER_CONFIG_VERSION),
    provider: Type.String(),
    modelId: Type.String(),
  },
  { additionalProperties: false },
);

type StoredProviderConfig = Static<typeof ProviderConfigSchema>;

/** The persisted selection, un-normalized (see provider-catalog). */
export type ProviderSelection = { provider: string; modelId: string };

const DEFAULT_CONFIG: StoredProviderConfig = {
  version: PROVIDER_CONFIG_VERSION,
  provider: DEFAULT_PROVIDER.id,
  modelId: DEFAULT_PROVIDER.defaultModelId,
};

export type ProviderConfigOptions = {
  storePath?: string;
  fs?: FsAdapter;
};

export class ProviderConfigStore {
  private readonly store: JsonStore<StoredProviderConfig>;

  constructor(options: ProviderConfigOptions = {}) {
    this.store = new JsonStore<StoredProviderConfig>(
      options.storePath ?? inteligirPath("provider-config.json"),
      ProviderConfigSchema,
      DEFAULT_CONFIG,
      {
        ...(options.fs ? { fs: options.fs } : {}),
        mode: 0o600,
        versioning: {
          current: PROVIDER_CONFIG_VERSION,
          fromLegacy: rejectLegacyVersion("provider-config"),
        },
      },
    );
  }

  get(): ProviderSelection {
    const { provider, modelId } = this.store.read();
    return { provider, modelId };
  }

  set(next: ProviderSelection): ProviderSelection {
    this.store.write({
      version: PROVIDER_CONFIG_VERSION,
      provider: next.provider,
      modelId: next.modelId,
    });
    return this.get();
  }

  /** Disable writes (one-way). Called by resetProviderConfig during logout
   * teardown so a warm cache can't resurrect the file after the AGENT_DIR rm. */
  close(): void {
    this.store.close();
  }
}

let instance: ProviderConfigStore | null = null;

export function getProviderConfig(): ProviderConfigStore {
  if (!instance) instance = new ProviderConfigStore();
  return instance;
}

export function resetProviderConfig(): void {
  instance?.close();
  instance = null;
}
