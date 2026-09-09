// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ParcelAsyncSubscription,
  ParcelWatcherBackend,
  ParcelWatcherError,
  ParcelWatcherEventBatch,
  ParcelWatcherSubscribeOptions,
} from "./parcel-backend";
import type { ChildToParentMessage, ParentToChildMessage, SerializedParcelEvent } from "./messages";

export interface ChildChannel {
  send: (message: ParentToChildMessage) => void;
  onMessage: (listener: (message: ChildToParentMessage) => void) => void;
  onExit: (listener: () => void) => void;
  kill: () => void;
}

type ProxyLogLevel = "info" | "warn" | "error";

interface ProxyLogFields {
  sinceLastPongMs?: number;
  delayMs?: number;
  consecutiveRestarts?: number;
  activeSubscriptions?: number;
  watchError?: string;
}

export interface ParcelWatcherProxyOptions {
  spawnChannel: () => ChildChannel;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  baseRestartDelayMs?: number;
  maxRestartDelayMs?: number;
  log?: (level: ProxyLogLevel, message: string, fields?: ProxyLogFields) => void;
}

type SubscribeCallback = (error: ParcelWatcherError, events: ParcelWatcherEventBatch) => void;

interface SubscriptionRecord {
  id: string;
  dir: string;
  opts: ParcelWatcherSubscribeOptions | undefined;
  callback: SubscribeCallback;
}

export interface ParcelWatcherProxy extends ParcelWatcherBackend {
  dispose: () => void;
}

const DEFAULT_PING_INTERVAL_MS = 5000;
const DEFAULT_PING_TIMEOUT_MS = 15_000;
const DEFAULT_BASE_RESTART_DELAY_MS = 250;
const DEFAULT_MAX_RESTART_DELAY_MS = 30_000;

const toEventBatch = (events: SerializedParcelEvent[]): ParcelWatcherEventBatch =>
  events.map((event) => ({ path: event.path, type: event.type }));

// a dead, wedged or errored child is sigkilled (the os reclaims leaked inotify fds and parked
// threads atomically) and every subscription is replayed under its original id, so callers
// never see the restart. the backoff resets once a child answers a ping; it never gives up.
export const createParcelWatcherProxy = (
  options: ParcelWatcherProxyOptions,
): ParcelWatcherProxy => {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const baseRestartDelayMs = options.baseRestartDelayMs ?? DEFAULT_BASE_RESTART_DELAY_MS;
  const maxRestartDelayMs = options.maxRestartDelayMs ?? DEFAULT_MAX_RESTART_DELAY_MS;
  const log =
    options.log ??
    (() => {
      /* empty */
    });

  const subscriptions = new Map<string, SubscriptionRecord>();
  let channel: ChildChannel | null = null;
  let childReady = false;
  let disposed = false;
  let consecutiveRestarts = 0;
  let respawnTimer: ReturnType<typeof setTimeout> | null = null;
  // a replacement child's replayed subscriptions request a gap-closing rescan.
  let restarting = false;
  let idCounter = 0;
  let lastPongAt = 0;
  let lastPingTickAt = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  // the child's events feed handlers that respawn it, so the spawn binds once those exist.
  let startChild = (): void => {
    log("error", "Watcher child spawn requested before the proxy was wired");
  };

  const nextId = (): string => {
    idCounter += 1;
    return `sub_${idCounter}`;
  };

  const stopPing = (): void => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const replaySubscriptions = (rescan: boolean): void => {
    // bind once: a failed send reports the child gone from inside this call, nulling channel
    // and maybe respawning, so re-reading per iteration would replay onto a child not yet ready.
    const target = channel;
    if (target === null) {
      return;
    }
    for (const record of subscriptions.values()) {
      target.send({
        dir: record.dir,
        id: record.id,
        kind: "subscribe",
        opts: record.opts,
        rescan,
      });
    }
  };

  const scheduleRespawn = (): void => {
    if (disposed || channel !== null || respawnTimer !== null) {
      return;
    }
    restarting = true;
    if (consecutiveRestarts === 0) {
      // a one-off failure heals instantly; only sustained churn backs off.
      consecutiveRestarts += 1;
      startChild();
      return;
    }
    const delay = Math.min(baseRestartDelayMs * 2 ** (consecutiveRestarts - 1), maxRestartDelayMs);
    consecutiveRestarts += 1;
    log("warn", "Backing off before watcher child respawn", {
      consecutiveRestarts,
      delayMs: delay,
    });
    respawnTimer = setTimeout(() => {
      respawnTimer = null;
      startChild();
    }, delay);
    respawnTimer.unref?.();
  };

  const killAndRespawn = (): void => {
    if (channel === null) {
      return;
    }
    const dying = channel;
    // detach first so the kill-triggered exit is treated as stale and the respawn runs once.
    channel = null;
    childReady = false;
    stopPing();
    dying.kill();
    scheduleRespawn();
  };

  const startPing = (): void => {
    stopPing();
    const now = Date.now();
    lastPongAt = now;
    lastPingTickAt = now;
    pingTimer = setInterval(() => {
      if (channel === null) {
        return;
      }
      const tickAt = Date.now();
      const sinceLastPingTickMs = tickAt - lastPingTickAt;
      lastPingTickAt = tickAt;
      if (sinceLastPingTickMs > pingIntervalMs + pingTimeoutMs) {
        // the parent itself stalled (laptop sleep, blocked loop): the silence says nothing
        // about the child.
        lastPongAt = tickAt;
        channel.send({ kind: "ping" });
        return;
      }
      if (tickAt - lastPongAt > pingTimeoutMs) {
        log("warn", "Watcher child unresponsive; killing", {
          sinceLastPongMs: tickAt - lastPongAt,
        });
        killAndRespawn();
        return;
      }
      channel.send({ kind: "ping" });
    }, pingIntervalMs);
    pingTimer.unref?.();
  };

  const handleChildExit = (source: ChildChannel): void => {
    if (source !== channel) {
      return;
    }
    channel = null;
    childReady = false;
    stopPing();
    if (disposed) {
      return;
    }
    log("warn", "Watcher child exited; respawning", {
      activeSubscriptions: subscriptions.size,
    });
    scheduleRespawn();
  };

  const handleChildMessage = (source: ChildChannel, message: ChildToParentMessage): void => {
    if (source !== channel) {
      return;
    }
    switch (message.kind) {
      case "ready": {
        childReady = true;
        replaySubscriptions(restarting);
        restarting = false;
        startPing();
        break;
      }
      case "pong": {
        lastPongAt = Date.now();
        consecutiveRestarts = 0;
        break;
      }
      case "events": {
        const record = subscriptions.get(message.id);
        record?.callback(null, toEventBatch(message.events));
        break;
      }
      case "watch-error": {
        // parcel's shared native backend died in the child (an EINTR poll interruption), taking
        // every watch down at once: recycle the whole child.
        log("warn", "Watcher child reported a backend error; recycling", {
          watchError: message.message,
        });
        killAndRespawn();
        break;
      }
      case "subscribe-failed": {
        // the caller owns the backed-off retry.
        const record = subscriptions.get(message.id);
        subscriptions.delete(message.id);
        record?.callback(new Error(message.message), []);
        break;
      }
      case "subscribed":
      case "unsubscribed": {
        break;
      }
      // no default
    }
  };

  startChild = (): void => {
    if (disposed) {
      return;
    }
    childReady = false;
    const spawned = options.spawnChannel();
    channel = spawned;
    spawned.onMessage((message) => {
      handleChildMessage(spawned, message);
    });
    spawned.onExit(() => {
      handleChildExit(spawned);
    });
  };

  // oxlint-disable-next-line require-await -- the backend contract is a promise; the proxy answers from its own state and defers the real subscribe to the child.
  const subscribe = async (
    dir: string,
    callback: SubscribeCallback,
    opts?: ParcelWatcherSubscribeOptions,
  ): Promise<ParcelAsyncSubscription> => {
    if (disposed) {
      throw new Error("Parcel watcher proxy is disposed");
    }
    const id = nextId();
    subscriptions.set(id, { callback, dir, id, opts });
    if (channel !== null && childReady) {
      channel.send({ dir, id, kind: "subscribe", opts, rescan: false });
    } else if (channel === null && respawnTimer === null) {
      startChild();
    }
    // a child that is spawning or backing off gets this subscription from replay-on-ready, once.
    return {
      // oxlint-disable-next-line require-await -- parcel's contract is a promise; the send is fire-and-forget.
      async unsubscribe() {
        subscriptions.delete(id);
        channel?.send({ id, kind: "unsubscribe" });
      },
    };
  };

  const dispose = (): void => {
    disposed = true;
    stopPing();
    if (respawnTimer !== null) {
      clearTimeout(respawnTimer);
      respawnTimer = null;
    }
    subscriptions.clear();
    if (channel !== null) {
      const dying = channel;
      channel = null;
      dying.kill();
    }
  };

  return { dispose, subscribe };
};
