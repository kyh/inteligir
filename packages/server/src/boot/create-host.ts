// ---------------------------------------------------------------------------
// createHost — the composition root for the node backend. It forces the
// dependency-ordered construction of the backend singletons
// (constructHostSingletons in singletons.ts), owns the notifier composition
// for the registry-free low-level pieces (store-recovery at build, vault-change
// at start — everything else emits to the event bus directly), and sequences
// init/teardown over those singletons. The pieces
// are process-global singletons reached through getX() (the one DI path, with a
// lazy test fallback), so the `created` guard makes a second call fail fast
// rather than silently share module state. A shell (the Electron desktop)
// injects a HostPlatform, serves the returned handler map over its transport
// (the ws host), forwards `events`, and drives start()/dispose().
// ---------------------------------------------------------------------------

import { configurePaths, SESSION_DIR_SEGMENTS, WORKSPACE_DIR } from "@repo/agent/paths";
import { setDevFlagsAllowed } from "@repo/bridge/dev-flags";
import { initMachine, shutdown } from "../app/app-machine";
import { emitEvent, subscribeEvents } from "../events";
import { constructHostSingletons } from "./singletons";
import { initAgentLog } from "@repo/storage/agent-log";
import { setSecretCipherProvider } from "@repo/storage/secrets";
import { configureVoiceModelHost } from "@repo/voice/model-download";
import { hardenAppDir } from "@repo/storage/harden-app-dir";
import { acquireHostLock, releaseHostLock } from "@repo/storage/host-lock";
import { collectHandlers, type HostHandlers } from "../handlers/handler-registry";
import { registerAllHandlers } from "../handlers/register-handlers";
import { getCaptureManager } from "../capture/capture-manager";
import { getDelegationManager } from "../delegation/delegation-manager";
import { disposeKnowledgeManager, getKnowledgeManager } from "../knowledge/knowledge-manager";
import {
  getSyncCoordinator,
  setSyncEventSink,
  setSyncVaultAccessor,
} from "@repo/sync/sync-coordinator";
import { installHostRuntime } from "../platform-instance";
import {
  getVaultManager,
  setVaultChangeNotifier,
  setVaultTrashItem,
  setVaultWorkspaceLinkDir,
} from "@repo/vault/vault";
import type { HostOptions, HostPlatform } from "../platform";
import type { EventMethod } from "@repo/bridge/ipc-registry";

export type HostEvents = {
  /** Every event-kind emission, in emit order. Returns unsubscribe. */
  onAny: (listener: (method: EventMethod, payload: unknown) => void) => () => void;
};

export type Host = {
  /** One validated handler per non-event registry method the host owns
   * (DESKTOP_SHELL_METHODS excluded — shell concern). Payloads are
   * schema-checked inside, so transports pass raw wire values straight in. */
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

  // Storage's SecretStore resolves its cipher through this provider at
  // construction (storage never imports the platform seam) — install it before
  // constructHostSingletons() eagerly builds the store.
  setSecretCipherProvider(() => platform.secretCipher);

  // Vault's user-initiated delete goes to the OS trash through this host
  // capability (vault/ never imports the platform seam). Installed before any
  // handler can reach trash(); resolved lazily at call time inside vault, so
  // it also survives a logout/login VaultManager reset.
  setVaultTrashItem(platform.trashItem);

  // Sync's coordinator broadcasts state through this sink (sync/ never
  // imports the host event bus) — installed before start() kicks the initial
  // reconcile so no state emission is dropped.
  setSyncEventSink(emitEvent);

  // Sync reaches the vault only through this injected accessor (#465 — no
  // extracted-pkg→extracted-pkg singleton coupling); the accessor keeps a
  // logout/login vault rebuild transparent.
  setSyncVaultAccessor(getVaultManager);

  // Voice's model machinery resolves the per-user data dir + progress events
  // through this seam (voice/ never imports the platform seam or the event
  // bus). Installed here at composition — not at handler registration — so a
  // boot-time "is voice available" probe resolves instead of hitting the
  // not-configured guard (#465.3); pre-composition, isModelInstalled/
  // downloadModel now answer with values (false / {ok:false}), never a throw.
  configureVoiceModelHost({
    userDataDir: () => platform.userDataDir,
    emitState: (event) => emitEvent("onVoiceModelState", event),
  });

  // Dev-only env flags (faux agent, emulate connectors) are honored ONLY in
  // unpackaged builds — computed ONCE here, before any handler or flag read.
  // A packaged install refuses the ambient env outright (dev-flags.ts); the
  // desktop main entry additionally refuses to start with a flag set.
  setDevFlagsAllowed(!platform.isPackaged);

  // Crash/debug visibility first, so even boot failures land in agent.log.
  initAgentLog();

  // Force the ordered construction of the core singletons and install the
  // notifier composition (store-recovery is wired inside, before any store is
  // read — it used to be an import-time side effect of notifications.ts).
  // `notifiers` also carries vault-change, wired in start() because the
  // watcher must not start until ensureReady() has run.
  const notifiers = constructHostSingletons();

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

      // Permission sweep before anything else touches app state: normalize
      // pre-existing installs (0755 session dirs, 0644 transcripts/stores —
      // note content) to owner-only. Best-effort by design, but keep the
      // whole call guarded too: a sweep failure must never block boot.
      try {
        hardenAppDir(SESSION_DIR_SEGMENTS);
      } catch (err) {
        console.warn("[host] app-dir permission sweep failed:", err);
      }

      // Must run before any pi-coding-agent call that consults getAgentDir().
      configurePaths();

      // Vault: ensure the folder + agent symlink exist, THEN wire the change
      // notifier. There is no recursive watcher anymore (vault liveness —
      // CLAUDE.md § Decisions) — the notifier
      // fires from app-initiated writes, the open-note watcher, and on-demand
      // refresh (focus / "Refresh vault" / delegation completion). The notifier
      // is module-scoped, so it survives a logout/login reset. Every vault change
      // nudges the knowledge index (in notifiers.vaultChange) and, when sync is
      // live, the sync engine — including a `save` (autosave), which must still
      // sync even though it does not broadcast onVaultChanged. Wrapping here
      // (once) keeps the sync engine rebuildable underneath without re-installing
      // this notifier.
      // Injected here (not imported by vault/) so the vault layer has zero
      // outbound capability edges — the host composes, vault receives.
      setVaultWorkspaceLinkDir(WORKSPACE_DIR);
      getVaultManager().ensureReady();
      const baseVaultNotifier = notifiers.vaultChange;
      setVaultChangeNotifier((root, kind) => {
        baseVaultNotifier(root, kind);
        getSyncCoordinator().onVaultChanged();
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

      // Deep-link captures that survived a crash or arrived on a cold launch:
      // drain the durable inbox now that the vault is ready. Exact-line dedupe
      // makes a re-drain of an already-applied line a no-op. Best-effort.
      try {
        getCaptureManager().drainPendingCaptures();
      } catch (err) {
        console.warn("[host] capture inbox drain failed:", err);
      }

      // Vault-sync — LIVE, gated at runtime (not by the build). The coordinator
      // reads its own config store (@repo/sync/sync-account.ts): it constructs
      // + starts the SyncEngine only when sync is enabled AND a bearer token is
      // present, and kicks an initial reconcile. Toggling config / signing in at
      // runtime rebuilds or tears the engine down; the vault-change wrapper above
      // routes local edits into it. OFF by default (no config = disabled). Only
      // vault FILES sync; the knowledge index + AI state live under ~/.inteligir
      // (outside the vault) and are never listed by the engine.
      getSyncCoordinator().start();

      initMachine();
    },
    async dispose() {
      getSyncCoordinator().dispose();
      disposeKnowledgeManager();
      await shutdown();
      releaseHostLock();
    },
  };
}
