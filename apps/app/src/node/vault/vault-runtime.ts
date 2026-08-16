// Composition root for the vault: repo init + tmp sweep, the CRUD service,
// the git engine, and the external-change watcher, wired to one notifier.
// The service's mutations run inside the git engine's repo lock, so a write
// can never interleave a rebase; the watcher's fan-out is suppressed while a
// sync holds that lock and replaced by ONE consolidated notification after.

import { writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { DbNotifier } from "@repo/db/notifier";
import type { VaultStatusResponse } from "@repo/server-contract/vault";
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

export interface VaultRuntimeArgs {
  vaultDir: string;
  /** null = local-only; the sync loop stays idle and status says "no-remote". */
  vaultRemote: string | null;
  /** The app's data dir. Must be disjoint from the vault (the vault is a git
   *  repo the sync loop pushes; a nested data dir would be staged into it). */
  dataDir: string;
  notifier: DbNotifier;
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

function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

function assertDisjoint(vaultDir: string, dataDir: string): void {
  if (pathContains(vaultDir, dataDir) || pathContains(dataDir, vaultDir)) {
    throw new Error(
      `The vault directory and the data directory must be disjoint, but vault "${vaultDir}" and data dir "${dataDir}" nest. ` +
        `Set INTELIGIR_VAULT_DIR (or config.json's vaultDir) to a folder outside the data dir.`,
    );
  }
}

export async function createVaultRuntime(args: VaultRuntimeArgs): Promise<VaultRuntime> {
  const root = resolve(args.vaultDir);
  // Config refuses this earlier for the shipping boot; re-asserted here so a
  // directly-composed runtime (tests, future callers) cannot skip it.
  assertDisjoint(root, resolve(args.dataDir));

  await ensureVaultRepo({
    root,
    seed: (vaultRoot) => writeFile(join(vaultRoot, WELCOME_FILE_NAME), WELCOME_CONTENT, "utf8"),
    ...(args.gitEnv ? { env: args.gitEnv } : {}),
  });
  await sweepStaleTmpFiles(root);

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
      git.scheduleCommit();
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
        if (stripSelfEchoes(paths).length === 0) {
          return;
        }
        args.notifier.notifyVault(["files-changed"]);
        git.scheduleCommit();
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
