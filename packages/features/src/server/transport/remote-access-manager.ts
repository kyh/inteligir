// ---------------------------------------------------------------------------
// RemoteAccessManager — the single owner of the WS transport's remote-access
// surface: the enable/port config (remote-access.json), the paired-device
// store (device-auth.ts), pairing-token mint, and the ws server's LISTENING
// state (the server registers itself via setListening; handlers query the
// manager). Every config / device / listen change fans out both to local
// subscribers (the ws host rebinds on config change) and to the registry
// event `onRemoteAccessChanged` for the renderer.
// ---------------------------------------------------------------------------

import os from "node:os";
import { type Static, Type } from "@sinclair/typebox";

import { emitEvent } from "../events";
import {
  JsonStore,
  inteligirPath,
  rejectLegacyVersion,
  type FsAdapter,
} from "../storage/json-store";
import { DeviceAuthStore, type PairingRedeemResult, type TokenValidator } from "./device-auth";
import type { PairingInfo, RemoteAccessState } from "@repo/features/remote-access";

const CONFIG_VERSION = 1;

export const DEFAULT_REMOTE_ACCESS_PORT = 47890;

const RemoteAccessConfigSchema = Type.Object(
  {
    version: Type.Literal(CONFIG_VERSION),
    enabled: Type.Boolean(),
    port: Type.Number(),
  },
  { additionalProperties: false },
);

type StoredConfig = Static<typeof RemoteAccessConfigSchema>;

const DEFAULT_CONFIG: StoredConfig = {
  version: CONFIG_VERSION,
  enabled: false,
  port: DEFAULT_REMOTE_ACCESS_PORT,
};

export type RemoteAccessConfig = { enabled: boolean; port: number };

export type RemoteAccessManagerOptions = {
  fs?: FsAdapter | undefined;
  configPath?: string | undefined;
  devicesPath?: string | undefined;
  now?: (() => number) | undefined;
};

export class RemoteAccessManager {
  private readonly configStore: JsonStore<StoredConfig>;
  private readonly devices: DeviceAuthStore;
  private listening = false;
  /** The port the ws server actually bound (ephemeral ports differ from
   * config); null while not listening. */
  private boundPort: number | null = null;
  /** The last bind failure the ws server reported; null while listening (or
   * before any failure). Lets the shell fail startup fast instead of waiting
   * out its bind timeout. */
  private listenError: string | null = null;
  private readonly changeListeners = new Set<(state: RemoteAccessState) => void>();

  constructor(opts: RemoteAccessManagerOptions = {}) {
    this.configStore = new JsonStore<StoredConfig>(
      opts.configPath ?? inteligirPath("remote-access.json"),
      RemoteAccessConfigSchema,
      DEFAULT_CONFIG,
      {
        fs: opts.fs,
        mode: 0o600,
        versioning: { current: CONFIG_VERSION, fromLegacy: rejectLegacyVersion("remote-access") },
      },
    );
    this.devices = new DeviceAuthStore({
      fs: opts.fs,
      devicesPath: opts.devicesPath,
      now: opts.now,
    });
  }

  /** The token-validation port the ws host consumes. */
  get validator(): TokenValidator {
    return this.devices;
  }

  /** The per-boot loopback renderer token (never persisted). */
  getLocalToken(): string {
    return this.devices.getLocalToken();
  }

  getConfig(): RemoteAccessConfig {
    const { enabled, port } = this.configStore.read();
    return { enabled, port };
  }

  getState(): RemoteAccessState {
    const { enabled, port } = this.getConfig();
    return {
      enabled,
      port,
      listening: this.listening,
      lanUrls: enabled ? this.lanUrls() : [],
      devices: this.devices.listDevices(),
    };
  }

  /** Patch config; an omitted field keeps its current value. Only `enabled`
   * crosses the Bridge — `port` is for tests and a future settings field. */
  setConfig(patch: { enabled?: boolean; port?: number }): RemoteAccessState {
    this.configStore.update((current) => ({
      version: CONFIG_VERSION,
      enabled: patch.enabled ?? current.enabled,
      port: patch.port ?? current.port,
    }));
    return this.notify();
  }

  createPairingToken(): PairingInfo {
    const { enabled, port } = this.getConfig();
    const { token, expiresAt } = this.devices.createPairingToken();
    const lanUrls = enabled ? this.lanUrls() : [];
    const urls = lanUrls.length > 0 ? lanUrls : [`ws://127.0.0.1:${this.boundPort ?? port}`];
    return { token, urls, expiresAt: new Date(expiresAt).toISOString() };
  }

  redeemPairingToken(pairingToken: string, deviceName: string): PairingRedeemResult {
    const result = this.devices.redeemPairingToken(pairingToken, deviceName);
    if (result.ok) this.notify();
    return result;
  }

  revokeDevice(id: string): RemoteAccessState {
    this.devices.revokeDevice(id);
    return this.notify();
  }

  /** Record a successful device auth (updates lastSeenAt). */
  touchDevice(id: string): void {
    this.devices.touchDevice(id);
    this.notify();
  }

  /** The ws server reports its listening state here (actual bound port, which
   * differs from config when the config port is 0/ephemeral). A bind failure
   * passes its message as `error`; a successful bind clears it. */
  setListening(listening: boolean, boundPort: number | null, error: string | null = null): void {
    this.listening = listening;
    this.boundPort = boundPort;
    this.listenError = listening ? null : error;
    this.notify();
  }

  /** The last bind failure, or null. See `listenError`. */
  getListenError(): string | null {
    return this.listenError;
  }

  /** Logout teardown: revoke every paired device and pending pairing token.
   * Fans out through notify() so the ws host closes any live remote socket
   * whose device just disappeared (the local renderer session is exempt). */
  invalidateCredentials(): void {
    this.devices.revokeAll();
    this.notify();
  }

  /** Subscribe to every state change. Returns unsubscribe. */
  onChange(listener: (state: RemoteAccessState) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  close(): void {
    this.changeListeners.clear();
    this.configStore.close();
    this.devices.close();
  }

  /** `ws://<addr>:<port>` per non-internal IPv4 interface — only meaningful
   * while remote access is enabled (otherwise the server binds loopback). */
  private lanUrls(): string[] {
    const port = this.boundPort ?? this.getConfig().port;
    const urls: string[] = [];
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) {
          urls.push(`ws://${address.address}:${port}`);
        }
      }
    }
    return urls;
  }

  private notify(): RemoteAccessState {
    const state = this.getState();
    for (const listener of this.changeListeners) listener(state);
    emitEvent("onRemoteAccessChanged", state);
    return state;
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the other host managers.
// ---------------------------------------------------------------------------

let instance: RemoteAccessManager | null = null;

export function getRemoteAccessManager(): RemoteAccessManager {
  if (!instance) instance = new RemoteAccessManager();
  return instance;
}

/** Logout teardown: wipe every remote credential (dropping the live sockets
 * that presented them), then close the stores so a stale reference can't
 * resurrect a file after ~/.inteligir is rm -rf'd. */
export function resetRemoteAccessManager(): void {
  instance?.invalidateCredentials();
  instance?.close();
  instance = null;
}
