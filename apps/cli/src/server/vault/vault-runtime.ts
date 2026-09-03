import { resolve } from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import type { VaultRemoteProvider } from "../cloud/vault-remote";
import { assertVaultAndDataDirDisjoint } from "../path-containment";
import { ensureVaultRepo, type EnsureVaultRepoArgs } from "./git-bootstrap";
import { createGitEngine, type GitEngine, type GitEngineArgs } from "./git-engine";
import { seedVault } from "./seed-vault";
import { createVaultService, sweepStaleTmpFiles, type VaultService } from "./vault-service";
import { createVaultWatcher, type VaultWatcher, type VaultWatcherArgs } from "./watcher";
import type { ParcelWatcherBackend } from "./watcher/parcel-backend";

const DEFAULT_SYNC_INTERVAL_MS = 60_000;

const SELF_WRITE_ECHO_WINDOW_MS = 2_000;

// "unknown" has no path list (the consolidated post-sync change): a consumer must re-diff.
export type VaultFilesChange = { kind: "paths"; paths: readonly string[] } | { kind: "unknown" };

export interface VaultRuntimeArgs {
  vaultDir: string;
  remote: VaultRemoteProvider;
  dataDir: string;
  notifier: DbNotifier;
  onFilesChanged?: (change: VaultFilesChange) => void;
  watch?: boolean;
  syncIntervalMs?: number | null;
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
  // config refuses this earlier; re-asserted so a directly composed runtime cannot skip it.
  assertVaultAndDataDirDisjoint(root, resolve(args.dataDir));

  const ensureArgs: EnsureVaultRepoArgs = {
    root,
    seed: (vaultRoot) => seedVault(vaultRoot),
    remote: args.remote(),
  };
  if (args.gitEnv) ensureArgs.env = args.gitEnv;
  await ensureVaultRepo(ensureArgs);
  // a full recursive walk nothing waits on: boot must not hold the listener behind it.
  void sweepStaleTmpFiles(root, Date.now()).catch((cause: unknown) => {
    console.error(`vault: stale staging sweep failed: ${String(cause)}`);
  });

  // watcher batches held back while a sync ran; drained as one notification.
  let sawChangesDuringSync = false;

  const gitArgs: GitEngineArgs = {
    root,
    remote: args.remote,
    onStatusChanged: () => {
      args.notifier.notifyVault(["sync-status-changed"]);
      if (!gitIsSyncing() && sawChangesDuringSync) {
        sawChangesDuringSync = false;
        args.notifier.notifyVault(["files-changed"]);
        // the held-back batches' paths are gone.
        args.onFilesChanged?.({ kind: "unknown" });
        git.scheduleCommit();
      }
    },
    onFilesChanged: () => {
      // mid-sync: hold it with the watcher's batches for the consolidated notification.
      sawChangesDuringSync = true;
    },
    onError: (message) => console.error(`vault git: ${message}`),
  };
  if (args.gitEnv) gitArgs.env = args.gitEnv;
  const git = createGitEngine(gitArgs);
  const gitIsSyncing = () => git.isSyncing();

  // the mutation already notified directly, so its watcher echo would only double-invalidate.
  // recursive dir ops may still echo once through their children; not worth tracking a subtree.
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
    const watcherArgs: VaultWatcherArgs = {
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
    };
    if (args.watcherBackend) watcherArgs.backend = args.watcherBackend;
    watcher = createVaultWatcher(watcherArgs);
    watcher.start();
  }

  // a crash between a write and its debounced commit leaves the tree dirty with no event.
  git.scheduleCommit();

  const syncIntervalMs =
    args.syncIntervalMs === undefined ? DEFAULT_SYNC_INTERVAL_MS : args.syncIntervalMs;
  if (syncIntervalMs !== null) {
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
