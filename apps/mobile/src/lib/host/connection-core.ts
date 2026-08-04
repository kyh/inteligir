// ---------------------------------------------------------------------------
// The connection owner — one live ws bridge to the saved desktop environment,
// with app-lifecycle awareness: drop it on background, recreate on foreground
// (the bridge's own supervisor handles retries while foregrounded). PURE: the
// bridge factory, the lifecycle source, the clock and the timer are injected,
// so tests drive transitions with fakes; connection.ts binds createWsBridge +
// React Native's AppState and adds the useSyncExternalStore hook.
//
// The background drop is DEFERRED, not immediate. iOS keeps sockets alive
// briefly across a background (an app switch, a glance at a notification), and
// tearing the bridge down rejects everything in flight — a chat send made a
// moment before the phone went to sleep. So `suspend()` records the moment and
// arms a close; a `resume()` inside the reuse window over a still-connected
// socket cancels it and keeps the session whole.
//
// `unauthorized` is sticky: the host revoked (or lost) our device token, so a
// foreground resume does NOT re-present the dead credential. The environment
// is deliberately NOT deleted — the desktop may simply have remote access
// toggled off — the UI surfaces the state and offers re-pairing; only a new
// `start()` (fresh pairing, or an explicit retry) clears it.
// ---------------------------------------------------------------------------

import type { Schedule } from "@repo/bridge/backoff";
import type { Bridge } from "@repo/bridge/ipc-registry";
import type { WsBridgeStatus } from "@repo/bridge/ws-bridge";
import { createExternalStore } from "../external-store";
import type { KnownEnvironment } from "./environment-store";

/** `none` = no environment started (unpaired or stopped). */
type HostStatus = "none" | WsBridgeStatus;

/** How long a backgrounded socket is held before it is closed for good. Long
 * enough to cover an app switch, short enough that a phone left in a pocket
 * isn't holding a desktop socket open. */
export const SOCKET_REUSE_WINDOW_MS = 20_000;

/**
 * May a resume keep the socket it backgrounded with? Only when the gap is
 * inside the reuse window AND the connection is still up — a socket the OS
 * (or the host) dropped while we were away must be rebuilt, and a clock that
 * moved backwards proves nothing, so it rebuilds too.
 */
export function shouldReuseSocket(input: {
  readonly backgroundedAt: number;
  readonly now: number;
  readonly windowMs: number;
  readonly status: HostStatus;
}): boolean {
  const gap = input.now - input.backgroundedAt;
  if (gap < 0 || gap > input.windowMs) return false;
  return input.status === "connected";
}

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
  /** Epoch ms. `Date.now` in prod. */
  now: () => number;
  /** Timer for the deferred background close. `timeoutSchedule` in prod. */
  schedule: Schedule;
}): HostConnection {
  let env: KnownEnvironment | null = null;
  let handle: { bridge: Bridge; dispose: () => void } | null = null;
  let status: HostStatus = "none";
  /** When the app last went to background with a live bridge; null while
   * foregrounded. */
  let backgroundedAt: number | null = null;
  let cancelDeferredClose: (() => void) | null = null;
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

  /** Drop the deferred-close timer and the background moment it belongs to. */
  function clearBackground(): void {
    cancelDeferredClose?.();
    cancelDeferredClose = null;
    backgroundedAt = null;
  }

  function dropBridge(): void {
    closeBridge();
    setStatus("disconnected");
  }

  function suspend(): void {
    // `unauthorized` keeps its handle (the bridge stops retrying rather than
    // disposing), so `handle !== null` does not mean there is a live session
    // to defer. Arming the close there would let it fire and overwrite the
    // sticky status with `disconnected`, and the next resume would re-present
    // the credential the host already rejected.
    if (handle === null || status === "unauthorized" || backgroundedAt !== null) return;
    backgroundedAt = deps.now();
    cancelDeferredClose = deps.schedule(() => {
      cancelDeferredClose = null;
      dropBridge();
    }, SOCKET_REUSE_WINDOW_MS);
  }

  function resume(): void {
    const since = backgroundedAt;
    clearBackground();
    // `unauthorized` stays terminal until an explicit start().
    if (env === null || status === "unauthorized") return;
    if (handle !== null) {
      // Never suspended (a redundant `active`), or suspended briefly over a
      // socket that survived — either way there is nothing to rebuild.
      const keep =
        since === null ||
        shouldReuseSocket({
          backgroundedAt: since,
          now: deps.now(),
          windowMs: SOCKET_REUSE_WINDOW_MS,
          status,
        });
      if (keep) return;
      dropBridge();
    }
    openBridge(env);
  }

  const unsubscribeLifecycle = deps.lifecycle.subscribe((state) => {
    if (state === "active") resume();
    else suspend();
  });

  function stop(): void {
    clearBackground();
    closeBridge();
    env = null;
    status = "none";
    publish();
  }

  return {
    start: (nextEnv) => {
      clearBackground();
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
