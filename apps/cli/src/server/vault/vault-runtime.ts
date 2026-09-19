import path from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import type { VaultRemoteProvider } from "../cloud/vault-remote";
import { assertVaultAndDataDirDisjoint } from "../path-containment";
import { ensureVaultRepo } from "./git-bootstrap";
import type { EnsureVaultRepoArgs } from "./git-bootstrap";
import { createGitEngine } from "./git-engine";
import type { GitEngine, GitEngineArgs } from "./git-engine";
import { seedVault } from "./seed-vault";
import { createVaultService, sweepStaleTmpFiles } from "./vault-service";
import type { VaultService } from "./vault-service";
import { createVaultWatcher } from "./watcher";
import type { VaultWatcher, VaultWatcherArgs } from "./watcher";
import type { ParcelWatcherBackend } from "./watcher/parcel-backend";

const DEFAULT_SYNC_INTERVAL_MS = 60_000;

const SELF_WRITE_ECHO_WINDOW_MS = 2000;

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
  status: () => Promise<VaultStatusResponse>;
  syncNow: () => Promise<VaultStatusResponse>;
  dispose: () => Promise<void>;
}

// a full recursive walk nothing waits on: boot must not hold the listener behind it.
const sweepStaleTmpFilesInBackground = async (root: string): Promise<void> => {
  try {
    await sweepStaleTmpFiles(root, Date.now());
  } catch (error) {
    console.error(`vault: stale staging sweep failed: ${String(error)}`);
  }
};

export const createVaultRuntime = async (args: VaultRuntimeArgs): Promise<VaultRuntime> => {
  const root = path.resolve(args.vaultDir);
  // config refuses this earlier; re-asserted so a directly composed runtime cannot skip it.
  assertVaultAndDataDirDisjoint(root, path.resolve(args.dataDir));

  const ensureArgs: EnsureVaultRepoArgs = {
    remote: args.remote(),
    root,
    seed: async (vaultRoot) => {
      await seedVault(vaultRoot);
    },
  };
  if (args.gitEnv) {
    ensureArgs.env = args.gitEnv;
  }
  await ensureVaultRepo(ensureArgs);
  void sweepStaleTmpFilesInBackground(root);

  // watcher batches held back while a sync ran; drained as one notification.
  let sawChangesDuringSync = false;

  // the engine's own status callback reads it back, so it lands in a slot the args close over.
  let engine: GitEngine | null = null;
  const gitIsSyncing = () => engine?.isSyncing() ?? false;

  const gitArgs: GitEngineArgs = {
    onError: (message) => {
      console.error(`vault git: ${message}`);
    },
    onFilesChanged: () => {
      // mid-sync: hold it with the watcher's batches for the consolidated notification.
      sawChangesDuringSync = true;
    },
    onStatusChanged: () => {
      args.notifier.notifyVault(["sync-status-changed"]);
      if (engine !== null && !engine.isSyncing() && sawChangesDuringSync) {
        sawChangesDuringSync = false;
        args.notifier.notifyVault(["files-changed"]);
        // the held-back batches' paths are gone.
        args.onFilesChanged?.({ kind: "unknown" });
        engine.scheduleCommit();
      }
    },
    remote: args.remote,
    root,
  };
  if (args.gitEnv) {
    gitArgs.env = args.gitEnv;
  }
  const git = createGitEngine(gitArgs);
  engine = git;

  // the mutation already notified directly, so its watcher echo would only double-invalidate.
  // recursive dir ops may still echo once through their children; not worth tracking a subtree.
  const recentSelfWrites = new Map<string, number>();
  const noteSelfWrites = (paths: readonly string[]): void => {
    const now = Date.now();
    for (const notePath of paths) {
      recentSelfWrites.set(notePath, now);
    }
  };
  const stripSelfEchoes = (paths: readonly string[]): string[] => {
    const now = Date.now();
    for (const [notePath, at] of recentSelfWrites) {
      if (now - at > SELF_WRITE_ECHO_WINDOW_MS) {
        recentSelfWrites.delete(notePath);
      }
    }
    return paths.filter((notePath) => !recentSelfWrites.has(notePath));
  };

  const service = createVaultService({
    lock: async (work) => await git.runExclusive(work),
    notifier: args.notifier,
    onMutated: (paths) => {
      noteSelfWrites(paths);
      args.onFilesChanged?.({ kind: "paths", paths });
      git.scheduleCommit(paths);
    },
    root,
  });

  let watcher: VaultWatcher | null = null;
  if (args.watch ?? true) {
    const watcherArgs: VaultWatcherArgs = {
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
      onError: (message) => {
        console.error(`vault watcher: ${message}`);
      },
      root,
    };
    if (args.watcherBackend) {
      watcherArgs.backend = args.watcherBackend;
    }
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
    async dispose() {
      await watcher?.dispose();
      await git.dispose();
    },
    git,
    service,
    status: async () => await git.status(),
    syncNow: async () => await git.syncNow(),
  };
};
