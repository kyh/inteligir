// ---------------------------------------------------------------------------
// The connection owner — one live ws bridge to the saved desktop environment,
// with app-lifecycle awareness: dispose on background, recreate on foreground
// (the bridge's own supervisor handles retries while foregrounded). PURE: the
// bridge factory and the lifecycle source are injected, so tests drive
// transitions with fakes; connection.ts binds createWsBridge + React Native's
// AppState and adds the useSyncExternalStore hook.
//
// `unauthorized` is sticky: the host revoked (or lost) our device token, so a
// foreground resume does NOT re-present the dead credential. The environment
// is deliberately NOT deleted — the desktop may simply have remote access
// toggled off — the UI surfaces the state and offers re-pairing; only a new
// `start()` (fresh pairing, or an explicit retry) clears it.
// ---------------------------------------------------------------------------

import type { Bridge } from "@repo/bridge/ipc-registry";
import type { WsBridgeStatus } from "@repo/bridge/ws-bridge";
import { createExternalStore } from "../external-store";
import type { KnownEnvironment } from "./environment-store";

/** `none` = no environment started (unpaired or stopped). */
type HostStatus = "none" | WsBridgeStatus;

export type HostSnapshot = {
  readonly status: HostStatus;
  /** The active environment's display name; null when status is `none`. */
  readonly envName: string | null;
};

/** Exactly what `createWsBridge` accepts — tests inject a controllable one. */
export type BridgeFactory = (options: {
  url: string;
  token: string;
  onStatus: (status: WsBridgeStatus) => void;
}) => { bridge: Bridge; dispose: () => void };

/** The app-lifecycle seam: `active` = foreground, `background` = not. */
export type LifecyclePort = {
  subscribe(listener: (state: "active" | "background") => void): () => void;
};

export type HostConnection = {
  /** Connect to an environment (replacing any current connection). */
  start(env: KnownEnvironment): void;
  /** Disconnect and forget the active environment (status → `none`). */
  stop(): void;
  /** The live bridge, or null when stopped / unauthorized. Requests made
   * while merely disconnected queue inside the bridge until reconnect. */
  getBridge(): Bridge | null;
  // Declared as function PROPERTIES, not methods: React reads these detached
  // (`useSyncExternalStore(connection.subscribe, connection.getSnapshot)`), so
  // the type has to promise they carry no `this`.
  getSnapshot: () => HostSnapshot;
  subscribe: (onChange: () => void) => () => void;
  /** Tear down everything including the lifecycle subscription (tests). */
  dispose(): void;
};

export function createHostConnection(deps: {
  createBridge: BridgeFactory;
  lifecycle: LifecyclePort;
}): HostConnection {
  let env: KnownEnvironment | null = null;
  let handle: { bridge: Bridge; dispose: () => void } | null = null;
  let status: HostStatus = "none";
  const store = createExternalStore<HostSnapshot>({ status: "none", envName: null });

  function publish(): void {
    store.set({ status, envName: env?.name ?? null });
  }

  function setStatus(next: HostStatus): void {
    if (status === next) return;
    status = next;
    publish();
  }

  function closeBridge(): void {
    const current = handle;
    handle = null;
    // handle is nulled FIRST so the final onStatus the dispose fires is
    // recognized as stale and dropped — the owner decides the post-close
    // status (`disconnected` on suspend, `none` on stop), not the bridge.
    current?.dispose();
  }

  function openBridge(current: KnownEnvironment): void {
    // The factory emits `connecting` synchronously, before it returns — the
    // session token (assigned inside onStatus's closure via `created`)
    // distinguishes "this bridge" from a disposed predecessor.
    let created: { bridge: Bridge; dispose: () => void } | null = null;
    const next = deps.createBridge({
      url: current.wsUrl,
      token: current.deviceToken,
      onStatus: (bridgeStatus) => {
        // Drop events from a bridge that is no longer (or not yet fully)
        // the active handle — except the synchronous burst during creation,
        // when `created` is still null and `handle` already cleared.
        if (created !== null && handle !== created) return;
        setStatus(bridgeStatus);
      },
    });
    created = next;
    handle = next;
    publish();
  }

  function suspend(): void {
    if (handle === null) return;
    closeBridge();
    setStatus("disconnected");
  }

  function resume(): void {
    // Recreate only when a started environment is dormant; `unauthorized`
    // stays terminal until an explicit start().
    if (env === null || handle !== null || status === "unauthorized") return;
    openBridge(env);
  }

  const unsubscribeLifecycle = deps.lifecycle.subscribe((state) => {
    if (state === "active") resume();
    else suspend();
  });

  function stop(): void {
    closeBridge();
    env = null;
    status = "none";
    publish();
  }

  return {
    start: (nextEnv) => {
      closeBridge();
      env = nextEnv;
      openBridge(nextEnv);
    },
    stop,
    getBridge: () => (status === "unauthorized" ? null : (handle?.bridge ?? null)),
    getSnapshot: store.get,
    subscribe: store.subscribe,
    dispose: () => {
      unsubscribeLifecycle();
      stop();
    },
  };
}
