// ---------------------------------------------------------------------------
// createHost — the composition root of the node backend. A shell (Electron
// desktop today, WebSocket server later) injects a HostPlatform, folds the
// returned handler map into its transport, forwards `events`, and drives
// start()/dispose() around its own lifecycle.
// ---------------------------------------------------------------------------

import { configurePaths } from "./agent/paths";
import { initMachine, shutdown } from "./app/app-machine";
import { getDelegationManager } from "./delegation/delegation-manager";
import { emitEvent, subscribeEvents } from "./events";
import { initAgentLog } from "./lib/agent-log";
import { acquireHostLock, releaseHostLock } from "./lib/host-lock";
import { collectHandlers, type HostHandlers } from "./lib/handler-registry";
import { registerAllHandlers } from "./handlers/register-handlers";
import { disposeKnowledgeManager, getKnowledgeManager } from "./knowledge/knowledge-manager";
import { getNotifications } from "./notifications";
import { installHostRuntime } from "./platform-instance";
import { setStoreRecoveryNotifier } from "./lib/json-store";
import { getVaultManager, setVaultChangeNotifier } from "./vault/vault";
import type { HostOptions, HostPlatform } from "./platform";
import type { EventMethod } from "@repo/features/ipc-registry";

export type HostEvents = {
  /** Every event-kind emission, in emit order. Returns unsubscribe. */
  onAny: (listener: (method: EventMethod, payload: unknown) => void) => () => void;
};

export type Host = {
  /** One validated handler per non-event registry method the host owns
   * (UPDATE_METHODS excluded — shell concern). Payloads are schema-checked
   * inside, so transports pass raw wire values straight in. */
  handlers: HostHandlers;
  events: HostEvents;
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
  initAgentLog();

  // Quarantine notices must be user-visible before any store is read. This
  // was an import-time side effect of notifications.ts; explicit here so a
  // shell that never constructs notifications still surfaces recovery events.
  setStoreRecoveryNotifier((event) => getNotifications().notifyStoreRecovered(event));

  const handlers = collectHandlers(registerAllHandlers);

  let started = false;

  return {
    handlers,
    events: { onAny: subscribeEvents },
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
      // module-scoped, so it survives a logout/login reset. Every vault change
      // also nudges the knowledge index (debounced incremental refresh).
      getVaultManager().ensureReady();
      setVaultChangeNotifier((root) => {
        emitEvent("onVaultChanged", { root });
        getKnowledgeManager().scheduleRefresh();
      });
      // First index build rides the debounce too, keeping it off the boot
      // path; a query landing earlier builds lazily.
      getKnowledgeManager().scheduleRefresh();

      // Snapshot retention sweep (keep the newest SNAPSHOT_RETENTION pre-run
      // copies). Best-effort — a prune failure must never block boot.
      try {
        getDelegationManager().pruneSnapshots();
      } catch (err) {
        console.warn("[host] delegation snapshot prune failed:", err);
      }

      initMachine();
    },
    async dispose() {
      disposeKnowledgeManager();
      await shutdown();
      releaseHostLock();
    },
  };
}
