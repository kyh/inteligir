// Composition root for the vault: repo init + tmp sweep, the CRUD service,
// the git engine, and the external-change watcher, wired to one notifier.
// The service's mutations run inside the git engine's repo lock, so a write
// can never interleave a rebase; the watcher's fan-out is suppressed while a
// sync holds that lock and replaced by ONE consolidated notification after.

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import type { VaultStatusResponse } from "@repo/server-contract/vault";
import { assertVaultAndDataDirDisjoint } from "../path-containment";
import { createGitEngine, ensureVaultRepo, type GitEngine } from "./git";
import { createVaultService, sweepStaleTmpFiles, type VaultService } from "./vault-service";
import { createVaultWatcher, type VaultWatcher } from "./watcher";
import type { ParcelWatcherBackend } from "./watcher/parcel-backend";

const DEFAULT_SYNC_INTERVAL_MS = 60_000;

/** How long a service-written path suppresses its own watcher echo. */
const SELF_WRITE_ECHO_WINDOW_MS = 2_000;

const WELCOME_FILE_NAME = "Welcome.md";
const WELCOME_CONTENT = `# Welcome to inteligir

This folder is your vault: plain markdown files that belong to you, versioned
with git. Edit them here or with any other tool — changes show up either way.
`;

/** What a file-level change announcement can say: the vault-relative paths
 * that moved, or "unknown" when a set of changes has no path list (the
 * consolidated post-sync notification) — a consumer must re-diff, not re-read
 * a named file. */
export type VaultFilesChange = { kind: "paths"; paths: readonly string[] } | { kind: "unknown" };

export interface VaultRuntimeArgs {
  vaultDir: string;
  /** null = local-only; the sync loop stays idle and status says "no-remote". */
  vaultRemote: string | null;
  /** The app's data dir. Must be disjoint from the vault (the vault is a git
   *  repo the sync loop pushes; a nested data dir would be staged into it). */
  dataDir: string;
  notifier: DbNotifier;
  /** Path-level twin of the notifier's vault announcement, for consumers that
   *  need to know WHICH files moved (the knowledge projection). Fired for
   *  service mutations, external watcher batches, and (as "unknown") the
   *  consolidated post-sync change. */
  onFilesChanged?: (change: VaultFilesChange) => void;
  /** false skips the filesystem watcher (tests that only exercise CRUD). */
  watch?: boolean;
  /** null disables the interval + boot sync (tests drive syncNow directly). */
  syncIntervalMs?: number | null;
  /** Tests: hermetic git env / in-process watcher backend. */
  gitEnv?: Record<string, string>;
  watcherBackend?: ParcelWatcherBackend;
}

export interface VaultRuntime {
  readonly service: VaultService;
  readonly git: GitEngine;
  status(): Promise<VaultStatusResponse>;
  syncNow(): Promise<VaultStatusResponse>;
  dispose(): Promise<void>;
}

export async function createVaultRuntime(args: VaultRuntimeArgs): Promise<VaultRuntime> {
  const root = resolve(args.vaultDir);
  // Config refuses this earlier for the shipping boot; re-asserted here so a
  // directly-composed runtime (tests, future callers) cannot skip it.
  assertVaultAndDataDirDisjoint(root, resolve(args.dataDir));

  await ensureVaultRepo({
    root,
    seed: (vaultRoot) => writeFile(join(vaultRoot, WELCOME_FILE_NAME), WELCOME_CONTENT, "utf8"),
    ...(args.gitEnv ? { env: args.gitEnv } : {}),
  });
  // A full recursive walk that nothing waits on — see the sweep's own note.
  // Boot must not hold the listener open behind it, so it runs beside
  // everything below and only ever unlinks what predates this call.
  void sweepStaleTmpFiles(root, Date.now()).catch((error: unknown) => {
    console.error(`vault: stale staging sweep failed: ${String(error)}`);
  });

  // Watcher batches held back while a sync ran; drained as ONE notification.
  let sawChangesDuringSync = false;

  const git = createGitEngine({
    root,
    remoteUrl: args.vaultRemote,
    onStatusChanged: () => {
      args.notifier.notifyVault(["sync-status-changed"]);
      if (!gitIsSyncing() && sawChangesDuringSync) {
        sawChangesDuringSync = false;
        args.notifier.notifyVault(["files-changed"]);
        // The batches were held back, so their paths are gone — announce that.
        args.onFilesChanged?.({ kind: "unknown" });
        git.scheduleCommit();
      }
    },
    onFilesChanged: () => {
      // A rebase moved the working tree. Mid-sync, so hold it with the
      // watcher's own batches and let the consolidated notification carry it.
      sawChangesDuringSync = true;
    },
    onError: (message) => console.error(`vault git: ${message}`),
    ...(args.gitEnv ? { env: args.gitEnv } : {}),
  });
  const gitIsSyncing = () => git.isSyncing();

  // Exact-path echo suppression for the service's own writes: the mutation
  // already notified directly (works with the watcher off, and without its
  // latency), so its watcher echo would only double-invalidate. Recursive dir
  // ops may still echo once through their children — a harmless extra
  // invalidation, not worth tracking a subtree for.
  const recentSelfWrites = new Map<string, number>();
  function noteSelfWrites(paths: readonly string[]): void {
    const now = Date.now();
    for (const path of paths) {
      recentSelfWrites.set(path, now);
    }
  }
  function stripSelfEchoes(paths: readonly string[]): string[] {
    const now = Date.now();
    for (const [path, at] of recentSelfWrites) {
      if (now - at > SELF_WRITE_ECHO_WINDOW_MS) {
        recentSelfWrites.delete(path);
      }
    }
    return paths.filter((path) => !recentSelfWrites.has(path));
  }

  const service = createVaultService({
    root,
    notifier: args.notifier,
    lock: (work) => git.runExclusive(work),
    onMutated: (paths) => {
      noteSelfWrites(paths);
      args.onFilesChanged?.({ kind: "paths", paths });
      git.scheduleCommit(paths);
    },
  });

  let watcher: VaultWatcher | null = null;
  if (args.watch ?? true) {
    watcher = createVaultWatcher({
      root,
      onChanged: (paths) => {
        if (gitIsSyncing()) {
          sawChangesDuringSync = true;
          return;
        }
        const external = stripSelfEchoes(paths);
        if (external.length === 0) {
          return;
        }
        args.notifier.notifyVault(["files-changed"], external);
        args.onFilesChanged?.({ kind: "paths", paths: external });
        git.scheduleCommit(external);
      },
      onError: (message) => console.error(`vault watcher: ${message}`),
      ...(args.watcherBackend ? { backend: args.watcherBackend } : {}),
    });
    watcher.start();
  }

  // Boot reconciliation: a crash between a write and its debounced commit
  // leaves the tree dirty with no event to trigger one — sweep it now.
  git.scheduleCommit();

  const syncIntervalMs =
    args.syncIntervalMs === undefined ? DEFAULT_SYNC_INTERVAL_MS : args.syncIntervalMs;
  if (args.vaultRemote !== null && syncIntervalMs !== null) {
    void git.syncNow();
    git.startAutoSync(syncIntervalMs);
  }

  return {
    service,
    git,
    status: () => git.status(),
    syncNow: () => git.syncNow(),
    async dispose() {
      await watcher?.dispose();
      await git.dispose();
    },
  };
}
