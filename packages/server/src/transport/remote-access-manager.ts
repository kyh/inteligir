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
import { JsonStore, inteligirPath, type FsAdapter } from "@repo/storage/json-store";
import { DeviceAuthStore, type PairingRedeemResult, type TokenValidator } from "./device-auth";
import {
  classifyEndpoints,
  LOOPBACK_ADDRESS,
  LOOPBACK_LABEL,
  type InterfaceTable,
} from "./network-endpoints";
import {
  BIND_ALL_ADDRESS,
  endpointAddress,
  type PairingInfo,
  type PairingUrl,
  type RemoteAccessState,
  type RemoteEndpoint,
} from "@repo/bridge/remote-access";

const CONFIG_VERSION = 2;

export const DEFAULT_REMOTE_ACCESS_PORT = Number(process.env["INTELIGIR_WS_PORT"] ?? 47890);

const RemoteAccessConfigSchema = Type.Object(
  {
    version: Type.Literal(CONFIG_VERSION),
    enabled: Type.Boolean(),
    port: Type.Number(),
    bindAddress: Type.String(),
  },
  { additionalProperties: false },
);

type StoredConfig = Static<typeof RemoteAccessConfigSchema>;

// A version mismatch drops the stored file, so every default here has to be
// the SAFE post-drop value — for bindAddress that is the every-interface bind,
// which is what the transport did before the field existed.
const DEFAULT_CONFIG: StoredConfig = {
  version: CONFIG_VERSION,
  enabled: false,
  port: DEFAULT_REMOTE_ACCESS_PORT,
  bindAddress: BIND_ALL_ADDRESS,
};

export type RemoteAccessConfig = {
  enabled: boolean;
  port: number;
  bindAddress: string;
  /** Bumped by every `setConfig` call, including one that changes nothing.
   * The ws host compares configs to decide rebinds, so without this a user
   * re-picking the address they are already pinned to — the one recovery an
   * unbound pin has — would compare equal and rebind nothing. Deliberately
   * in-memory: it orders binds within a process, it is not state. */
  revision: number;
};

export type RemoteAccessManagerOptions = {
  fs?: FsAdapter | undefined;
  configPath?: string | undefined;
  devicesPath?: string | undefined;
  now?: (() => number) | undefined;
  /** The OS interface table, read afresh on every query. Injected so tests can
   * pin an address list that would otherwise depend on the box's NICs;
   * production has no reason to set it. */
  networkInterfaces?: (() => InterfaceTable) | undefined;
};

export class RemoteAccessManager {
  private readonly configStore: JsonStore<StoredConfig>;
  private readonly devices: DeviceAuthStore;
  private listening = false;
  /** The port the ws server actually bound (ephemeral ports differ from
   * config); null while not listening. */
  private boundPort: number | null = null;
  /** The last bind failure the ws server reported; null once a bind reports
   * clean. Lets the shell fail startup fast instead of waiting out its bind
   * timeout. NOT cleared merely because the server is listening: a pinned
   * remote address that failed while loopback came up is exactly a listening
   * server WITH an error to tell the user about. */
  private listenError: string | null = null;
  /** The addresses the ws server reported binding, as it bound them. NOT
   * re-derived from the config: the config is a request, and a pinned address
   * that was absent at bind time (booting before the overlay is up) never
   * became a socket however available it looks now. */
  private boundHosts: readonly string[] = [];
  private revision = 0;
  private readonly changeListeners = new Set<(state: RemoteAccessState) => void>();
  private readonly readInterfaces: () => InterfaceTable;

  constructor(opts: RemoteAccessManagerOptions = {}) {
    this.readInterfaces = opts.networkInterfaces ?? (() => os.networkInterfaces());
    this.configStore = new JsonStore<StoredConfig>(
      opts.configPath ?? inteligirPath("remote-access.json"),
      RemoteAccessConfigSchema,
      DEFAULT_CONFIG,
      {
        fs: opts.fs,
        versioning: { current: CONFIG_VERSION },
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
    const { enabled, port, bindAddress } = this.configStore.read();
    return { enabled, port, bindAddress, revision: this.revision };
  }

  getState(): RemoteAccessState {
    const { enabled, port, bindAddress } = this.getConfig();
    return {
      enabled,
      port,
      bindAddress,
      boundAddresses: this.boundHosts,
      listening: this.listening,
      endpoints: this.endpoints(),
      devices: this.devices.listDevices(),
    };
  }

  /** Patch config; an omitted field keeps its current value. `enabled` and
   * `bindAddress` cross the Bridge — `port` is for tests and a future
   * settings field. */
  setConfig(patch: { enabled?: boolean; port?: number; bindAddress?: string }): RemoteAccessState {
    this.revision += 1;
    this.configStore.update((current) => ({
      version: CONFIG_VERSION,
      enabled: patch.enabled ?? current.enabled,
      port: patch.port ?? current.port,
      bindAddress: patch.bindAddress ?? current.bindAddress,
    }));
    return this.notify();
  }

  createPairingToken(): PairingInfo {
    const config = this.getConfig();
    const { token, expiresAt } = this.devices.createPairingToken();
    // An encrypted overlay address is the one worth handing out first: pairing
    // over it keeps the one-time token — and every frame after it — off the LAN
    // in the clear. It ORDERS the offer, it does not narrow it: a phone that
    // isn't on the tailnet can only reach the LAN address, and dropping that
    // would leave it with a single unreachable URL and no way to pair at all.
    // Virtual adapters are dropped though — they reach nobody at all — and
    // loopback is the last resort, not an offer.
    const remote = this.reachableEndpoints()
      .filter((endpoint) => endpoint.reachability !== "loopback" && !endpoint.virtual)
      .toSorted((a, b) => Number(b.encrypted) - Number(a.encrypted));
    const urls: readonly PairingUrl[] =
      remote.length > 0
        ? remote.map((endpoint) => ({ wsUrl: endpoint.wsUrl, label: endpoint.label }))
        : [
            {
              wsUrl: `ws://${LOOPBACK_ADDRESS}:${this.boundPort ?? config.port}`,
              label: LOOPBACK_LABEL,
            },
          ];
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
   * passes its message as `error` — including the partial case, where the
   * primary address is listening but a pinned one is not; a clean bind omits
   * it and clears the previous one. `boundHosts` is the addresses that came
   * up, and it is the ONLY authority on what a peer can dial. */
  setListening(
    listening: boolean,
    boundPort: number | null,
    error: string | null = null,
    boundHosts: readonly string[] = [],
  ): void {
    this.listening = listening;
    this.boundPort = boundPort;
    this.listenError = error;
    this.boundHosts = boundHosts;
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

  /** Every address this computer holds — the candidate set the settings bind
   * picker offers, independent of what the server currently binds. */
  private endpoints(): RemoteEndpoint[] {
    return classifyEndpoints(this.readInterfaces(), this.boundPort ?? this.getConfig().port);
  }

  /** The subset a peer can actually dial right now: the candidates narrowed to
   * the addresses the ws server REPORTED binding. */
  private reachableEndpoints(): RemoteEndpoint[] {
    if (this.boundHosts.includes(BIND_ALL_ADDRESS)) return this.endpoints();
    return this.endpoints().filter((endpoint) =>
      this.boundHosts.includes(endpointAddress(endpoint)),
    );
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
