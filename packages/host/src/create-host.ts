// ---------------------------------------------------------------------------
// createHost — the composition root of the node backend. A shell (Electron
// desktop today, WebSocket server later) injects a HostPlatform, folds the
// returned handler map into its transport, forwards `events`, and drives
// start()/dispose() around its own lifecycle.
// ---------------------------------------------------------------------------

import { configurePaths } from "./agent/paths";
import { initMachine, shutdown } from "./app/app-machine";
import { emitEvent, subscribeEvents } from "./events";
import { initAgentLog } from "./lib/agent-log";
import { acquireHostLock, releaseHostLock } from "./lib/host-lock";
import { collectHandlers, type HostHandlers } from "./lib/handler-registry";
import { registerAllHandlers } from "./handlers/register-handlers";
import { getNotifications } from "./notifications";
import { installHostRuntime } from "./platform-instance";
import { setStoreRecoveryNotifier } from "./lib/json-store";
import { getVaultManager, setVaultChangeNotifier } from "./vault/vault";
import type { HostOptions, HostPlatform } from "./platform";
import type { EventMethod } from "@repo/core/ipc-registry";

export type HostEvents = {
  /** Every event-kind emission, in emit order. Returns unsubscribe. */
  onAny: (listener: (method: EventMethod, payload: unknown) => void) => () => void;
};

export type HostCapabilities = {
  /** platform.pickDirectory present — the UI may offer "change vault". */
  canPickVault: boolean;
  /** Always false here: only the desktop shell overlays real electron-updater
   * handlers for the UPDATE_METHODS trio. */
  canSelfUpdate: boolean;
};

export type Host = {
  /** One validated handler per non-event registry method the host owns
   * (UPDATE_METHODS excluded — shell concern). Payloads are schema-checked
   * inside, so transports pass raw wire values straight in. */
  handlers: HostHandlers;
  events: HostEvents;
  capabilities: HostCapabilities;
  /** Boot the backend: pi paths, vault + watcher, app state machine.
   * Idempotent. Call after the transport fold is in place so early events
   * aren't dropped. */
  start: () => void;
  /** Graceful shutdown: agents + executor daemon + vault watcher. The hard
   * timeout stays in the shell (it decides what "wedged" means for its
   * process). */
  dispose: () => Promise<void>;
};

let created = false;

export function createHost(platform: HostPlatform, options: HostOptions = {}): Host {
  // Host modules are module-level singletons (exactly one host per process by
  // design); a second createHost would silently share their state.
  if (created) throw new Error("createHost() may only run once per process");
  created = true;

  installHostRuntime(platform, options);

  // Crash/debug visibility first, so even boot failures land in agent.log.
  if (options.agentLog !== false) initAgentLog();

  // Quarantine notices must be user-visible before any store is read. This
  // was an import-time side effect of notifications.ts; explicit here so a
  // shell that never constructs notifications still surfaces recovery events.
  setStoreRecoveryNotifier((event) => getNotifications().notifyStoreRecovered(event));

  const handlers = collectHandlers(registerAllHandlers);

  let started = false;

  return {
    handlers,
    events: { onAny: subscribeEvents },
    capabilities: {
      canPickVault: platform.pickDirectory !== undefined,
      canSelfUpdate: false,
    },
    start() {
      if (started) return;
      started = true;

      // Refuse to run two hosts over one ~/.inteligir (they'd resume the
      // same session thread, race the executor daemon, and a logout's
      // rm -rf would gut the other process). Throws to the shell, which
      // surfaces it and quits.
      acquireHostLock();

      // Must run before any pi-coding-agent call that consults getAgentDir().
      configurePaths();

      // Vault: ensure the folder + agent symlink exist and stream file changes
      // to the UI so the sidebar and editor stay live. The notifier is
      // module-scoped, so it survives a logout/login reset.
      getVaultManager().ensureReady();
      setVaultChangeNotifier((root) => emitEvent("onVaultChanged", { root }));

      initMachine();
    },
    async dispose() {
      await shutdown();
      releaseHostLock();
    },
  };
}
