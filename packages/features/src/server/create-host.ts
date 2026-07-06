// ---------------------------------------------------------------------------
// createHost — the composition root for the node backend. It constructs the
// explicit HostContext object graph (host-context.ts) in dependency order,
// owns the whole notifier composition (the 5 slots are wired at build/start,
// not mutated from app-machine), and sequences init/teardown over that graph.
// The pieces are still process-global singletons under the hood — getX() stays
// an accessor into this constructed graph with a lazy test fallback — so the
// `created` guard makes a second call fail fast rather than silently share
// module state. A shell (Electron desktop today, WebSocket server later)
// injects a HostPlatform, folds the returned handler map into its transport,
// forwards `events`, and drives start()/dispose().
// ---------------------------------------------------------------------------

import { configurePaths } from "./agent/paths";
import { initMachine, shutdown } from "./app/app-machine";
import { subscribeEvents } from "./events";
import { buildHostContext } from "./host-context";
import { initAgentLog } from "./lib/agent-log";
import { acquireHostLock, releaseHostLock } from "./lib/host-lock";
import { collectHandlers, type HostHandlers } from "./lib/handler-registry";
import { registerAllHandlers } from "./handlers/register-handlers";
import { disposeKnowledgeManager } from "./knowledge/knowledge-manager";
import { installHostRuntime } from "./platform-instance";
import { setVaultChangeNotifier } from "./vault/vault";
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

  // Build the object graph: constructs the core singletons in dependency order
  // and installs the notifier composition (store-recovery is wired inside,
  // before any store is read — it used to be an import-time side effect of
  // notifications.ts). ctx.notifiers holds the other four; vault-change is wired
  // in start() because the watcher must not start until ensureReady() has run.
  const ctx = buildHostContext();

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

      // Vault: ensure the folder + agent symlink exist, THEN wire the change
      // notifier (which starts the watcher — it must not start before the dir
      // exists), streaming file changes to the UI so the sidebar and editor
      // stay live. The notifier is module-scoped, so it survives a logout/login
      // reset. Every vault change also nudges the knowledge index (debounced
      // incremental refresh — that fan-out lives in ctx.notifiers.vaultChange).
      ctx.vault.ensureReady();
      setVaultChangeNotifier(ctx.notifiers.vaultChange);
      // First index build rides the debounce too, keeping it off the boot
      // path; a query landing earlier builds lazily.
      ctx.knowledge.scheduleRefresh();

      // Snapshot retention sweep (keep the newest SNAPSHOT_RETENTION pre-run
      // copies). Best-effort — a prune failure must never block boot.
      try {
        ctx.delegation.pruneSnapshots();
      } catch (err) {
        console.warn("[host] delegation snapshot prune failed:", err);
      }

      // ---------------------------------------------------------------------
      // Vault-sync capability — OFF by default (server/sync/). Deliberately not
      // constructed or started here: it is an available capability, not part of
      // the live boot path. When ctx.options.syncEnabled is flipped on (and the
      // coordinator origin + bearer token are configured), wire it HERE, e.g.:
      //
      //   if (ctx.options.syncEnabled) {
      //     const port = createHttpSyncPort({ baseUrl, vaultId, token });
      //     const sync = createSyncManager({ vaultId, port });
      //     sync.start();                       // subscribe to remote changes
      //     const prevNotifier = ctx.notifiers.vaultChange;
      //     setVaultChangeNotifier((root) => {  // + local-change debounce
      //       prevNotifier(root);
      //       sync.onVaultChanged();
      //     });
      //     void sync.syncOnce();               // initial reconcile
      //   }
      //
      // Only vault FILES sync; the knowledge index + AI state live under
      // ~/.inteligir (outside the vault) and are never listed by the manager.
      // ---------------------------------------------------------------------

      initMachine();
    },
    async dispose() {
      disposeKnowledgeManager();
      await shutdown();
      releaseHostLock();
    },
  };
}
