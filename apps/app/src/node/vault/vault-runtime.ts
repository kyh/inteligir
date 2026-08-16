// Composition root for the vault: repo init + tmp sweep, the CRUD service,
// the git engine, and the external-change watcher, wired to one notifier.

import { writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { DbNotifier } from "@repo/db/notifier";
import type { VaultStatusResponse } from "@repo/server-contract/vault";
import { createGitEngine, ensureVaultRepo, type GitEngine } from "./git";
import { createVaultService, sweepStaleTmpFiles, type VaultService } from "./vault-service";
import { createVaultWatcher, type VaultWatcher } from "./watcher";
import type { ParcelWatcherBackend } from "./watcher/parcel-backend";

const DEFAULT_SYNC_INTERVAL_MS = 60_000;

const WELCOME_FILE_NAME = "Welcome.md";
const WELCOME_CONTENT = `# Welcome to inteligir

This folder is your vault: plain markdown files that belong to you, versioned
with git. Edit them here or with any other tool — changes show up either way.
`;

export interface VaultRuntimeArgs {
  vaultDir: string;
  /** null = local-only; the sync loop stays idle and status says "no-remote". */
  vaultRemote: string | null;
  /** The app's data dir; excluded from the vault surface when nested inside it. */
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

export async function createVaultRuntime(args: VaultRuntimeArgs): Promise<VaultRuntime> {
  const root = resolve(args.vaultDir);
  const dataDir = resolve(args.dataDir);
  const ignoreAbsPaths = dataDir === root || dataDir.startsWith(root + sep) ? [dataDir] : [];

  await ensureVaultRepo({
    root,
    seed: (vaultRoot) => writeFile(join(vaultRoot, WELCOME_FILE_NAME), WELCOME_CONTENT, "utf8"),
    ...(args.gitEnv ? { env: args.gitEnv } : {}),
  });
  await sweepStaleTmpFiles(root);

  const git = createGitEngine({
    root,
    remoteUrl: args.vaultRemote,
    onStatusChanged: () => args.notifier.notifyVault(["sync-status-changed"]),
    onFilesChanged: () => args.notifier.notifyVault(["files-changed"]),
    onError: (message) => console.error(`vault git: ${message}`),
    ...(args.gitEnv ? { env: args.gitEnv } : {}),
  });

  const service = createVaultService({
    root,
    notifier: args.notifier,
    onMutated: () => git.scheduleCommit(),
    ignoreAbsPaths,
  });

  let watcher: VaultWatcher | null = null;
  if (args.watch ?? true) {
    watcher = createVaultWatcher({
      root,
      ignoreAbsPaths,
      onChanged: () => {
        args.notifier.notifyVault(["files-changed"]);
        git.scheduleCommit();
      },
      onError: (message) => console.error(`vault watcher: ${message}`),
      ...(args.watcherBackend ? { backend: args.watcherBackend } : {}),
    });
    watcher.start();
  }

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
