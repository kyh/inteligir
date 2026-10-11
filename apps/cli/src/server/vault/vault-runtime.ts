import path from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import { createVaultIgnore, isGitignorePath } from "@repo/notes/knowledge/vault-ignore";
import type { VaultIgnore } from "@repo/notes/knowledge/vault-ignore";
import type { ExternalSync } from "@repo/contract/local/vault/vault-schema";
import { NO_ORIGIN } from "../cloud/vault-remote";
import type { VaultRemoteProvider } from "../cloud/vault-remote";
import type { DebugLog } from "../debug-log";
import { assertVaultAndDataDirDisjoint } from "../path-containment";
import { ensureVaultRepo } from "./git-bootstrap";
import { createGitEngine } from "./git-engine";
import type { GitEngine, GitEngineArgs } from "./git-engine";
import type { GitRunner } from "./git-run";
import { seedVault } from "./seed-vault";
import type { ReadStall } from "./slow-reads";
import { entryFingerprintAt, sameEntryFingerprint } from "./vault-changes";
import type { EntryFingerprint, VaultFilesChange, VaultMutation } from "./vault-changes";
import { createVaultIgnoreHolder, loadVaultIgnore, readIgnoreCase } from "./vault-ignore-files";
import { createVaultService, sweepStaleTmpFiles } from "./vault-service";
import type { VaultService, VaultServiceArgs } from "./vault-service";
import { createVaultWatcher } from "./watcher";
import type { VaultWatcher, VaultWatcherArgs } from "./watcher";
import type { ParcelWatcherBackend } from "./watcher/parcel-backend";

const DEFAULT_SYNC_INTERVAL_MS = 60_000;

// eviction only: an echo is told by its fingerprint, and one arriving later than this is
// delivered like any other event.
const SELF_WRITE_ECHO_WINDOW_MS = 2000;

export interface VaultRuntimeArgs {
  vaultDir: string;
  remote: VaultRemoteProvider;
  // this device's name, which every vault commit carries as its committer (`deviceNameReader`).
  deviceName: () => string;
  // judged once at boot, as the provider's own copy was.
  externalSync?: ExternalSync | null;
  dataDir: string;
  notifier: DbNotifier;
  onFilesChanged?: (change: VaultFilesChange) => void;
  watch?: boolean;
  syncIntervalMs?: number | null;
  git: GitRunner;
  watcherBackend?: ParcelWatcherBackend;
  stallRead?: ReadStall;
  // the watcher's trace: its verdict per event, then what this runtime strips, holds or delivers.
  debugLog?: DebugLog | undefined;
}

// a watched batch is what the watcher saw outside a pass, less this server's echoes; a pulled
// change is a pass's drain, the batches it held included, naming no paths once any could not.
type VaultDelivery =
  | { source: "self"; mutations: readonly VaultMutation[] }
  | { source: "watched"; paths: readonly string[] }
  | { source: "pulled"; change: VaultFilesChange };

export interface VaultRuntime {
  readonly service: VaultService;
  readonly git: GitEngine;
  dispose: () => Promise<void>;
}

// a recursive walk nothing waits on: boot must not hold the listener behind it. it waits for the
// ignore rules, so the cutoff is the boot's, not the walk's start, which a save may already beat.
const sweepStaleTmpFilesInBackground = async (
  root: string,
  bootedAt: number,
  ignore: () => Promise<VaultIgnore>,
): Promise<void> => {
  try {
    await sweepStaleTmpFiles(root, bootedAt, await ignore());
  } catch (error) {
    console.error(`vault: stale staging sweep failed: ${String(error)}`);
  }
};

export const createVaultRuntime = async (args: VaultRuntimeArgs): Promise<VaultRuntime> => {
  const bootedAt = Date.now();
  const root = path.resolve(args.vaultDir);
  // config refuses this earlier; re-asserted so a directly composed runtime cannot skip it.
  assertVaultAndDataDirDisjoint(root, path.resolve(args.dataDir));

  await ensureVaultRepo({
    deviceName: args.deviceName(),
    git: args.git,
    // the clone is the one reader, and a folder not created yet has no origin to read.
    remote: args.remote(NO_ORIGIN),
    root,
    seed: async (vaultRoot) => {
      await seedVault(vaultRoot);
    },
  });

  const ignoreCase = await readIgnoreCase(async (gitArgs) => await args.git.run(root, gitArgs));
  // loaded off the listen's path: a listing awaits the load, so the first one waits, not the boot.
  const ignore = createVaultIgnoreHolder(
    async () => await loadVaultIgnore(root, { ignoreCase }),
    createVaultIgnore([], { ignoreCase }),
  );
  // beside the load, never inside it: the load runs again on every reload, and a sweep cut off
  // then could take a live write's staging file.
  void sweepStaleTmpFilesInBackground(root, bootedAt, ignore.current);

  // a change naming a .gitignore, or naming nothing, may move what the vault ignores. the rules
  // reload at once, so every listing from here waits on them, and the index is told to re-diff:
  // what they hid or revealed is exactly what no path in the change names.
  const noteFilesChanged = (change: VaultFilesChange): void => {
    if (change.kind === "paths" && !change.paths.some((changed) => isGitignorePath(changed))) {
      args.onFilesChanged?.(change);
      return;
    }
    ignore.reload();
    args.onFilesChanged?.({ kind: "unknown" });
  };

  // what a pass moved and the watcher batches held back while it ran, drained as one
  // notification when it ends; "unknown" once any of them could not name its paths.
  let heldDuringSync: Set<string> | "unknown" | null = null;
  const holdDuringSync = (change: VaultFilesChange): void => {
    if (change.kind === "unknown" || heldDuringSync === "unknown") {
      heldDuringSync = "unknown";
      return;
    }
    heldDuringSync ??= new Set();
    for (const changedPath of change.paths) {
      heldDuringSync.add(changedPath);
    }
  };

  // the mutation already announced itself, so its watcher echo would only double-invalidate.
  // an event is that echo only while the entry is still the one the mutation left, never by path
  // alone: a foreign write behind a save (an agent editing the open note) must still land.
  // recursive dir ops may still echo once through their children; not worth tracking a subtree.
  const recentSelfWrites = new Map<string, { at: number; left: EntryFingerprint }>();
  const noteSelfWrites = (mutations: readonly VaultMutation[]): void => {
    const at = Date.now();
    for (const mutation of mutations) {
      recentSelfWrites.set(mutation.path, { at, left: mutation.fingerprint });
    }
  };
  const stripSelfEchoes = async (paths: readonly string[]): Promise<string[]> => {
    const now = Date.now();
    for (const [notePath, { at }] of recentSelfWrites) {
      if (now - at > SELF_WRITE_ECHO_WINDOW_MS) {
        recentSelfWrites.delete(notePath);
      }
    }
    const echoes = await Promise.all(
      paths.map(async (notePath) => {
        const recorded = recentSelfWrites.get(notePath);
        return (
          recorded !== undefined &&
          sameEntryFingerprint(recorded.left, await entryFingerprintAt(path.join(root, notePath)))
        );
      }),
    );
    return paths.filter((notePath, index) => {
      const echo = echoes[index] === true;
      if (echo) {
        args.debugLog?.(`${notePath}: dropped, the echo of this server's own write`);
      }
      return !echo;
    });
  };

  // the engine's own status callback reads it back, so it lands in a slot the args close over.
  let engine: GitEngine | null = null;
  const gitIsSyncing = () => engine?.isSyncing() ?? false;

  // every change reaches the bus, the index and the commit scheduler here alone. files-changed
  // makes every client re-walk the vault, so of this server's own writes only one that moved a
  // row says it; a save behind a row that stays says content-changed for its note alone, since
  // files-changed too would cost the open note two reads and the workspace a re-walk per autosave.
  // the engine's drain calls it, so it commits through the slot, set before the service or the
  // watcher exists to deliver anything.
  const deliver = (delivery: VaultDelivery): void => {
    switch (delivery.source) {
      case "self": {
        const moved: string[] = [];
        for (const mutation of delivery.mutations) {
          if (mutation.kind === "content") {
            args.notifier.notifyDoc(mutation.path, ["content-changed"]);
          } else {
            moved.push(mutation.path);
          }
        }
        if (moved.length > 0) {
          args.notifier.notifyVault(["files-changed"], moved);
        }
        noteSelfWrites(delivery.mutations);
        const paths = delivery.mutations.map((mutation) => mutation.path);
        noteFilesChanged({ kind: "paths", paths });
        engine?.scheduleCommit(paths);
        return;
      }
      case "watched": {
        args.notifier.notifyVault(["files-changed"], delivery.paths);
        noteFilesChanged({ kind: "paths", paths: delivery.paths });
        engine?.scheduleCommit(delivery.paths);
        return;
      }
      case "pulled": {
        const { change } = delivery;
        if (change.kind === "unknown") {
          args.notifier.notifyVault(["files-changed"]);
        } else {
          args.notifier.notifyVault(["files-changed"], change.paths);
        }
        noteFilesChanged(change);
        engine?.scheduleCommit();
        return;
      }
      default: {
        const exhaustive: never = delivery;
        return exhaustive;
      }
    }
  };

  const gitArgs: GitEngineArgs = {
    deviceName: args.deviceName,
    git: args.git,
    onError: (message) => {
      console.error(`vault git: ${message}`);
    },
    onNotice: (message) => {
      console.log(`vault git: ${message}`);
    },
    // mid-sync: held with the watcher's batches for the consolidated notification.
    onFilesChanged: holdDuringSync,
    onStatusChanged: () => {
      args.notifier.notifyVault(["sync-status-changed"]);
      const held = heldDuringSync;
      if (engine === null || engine.isSyncing() || held === null) {
        return;
      }
      heldDuringSync = null;
      args.debugLog?.(
        held === "unknown"
          ? "the vault sync ended: releasing a change that names no paths"
          : `the vault sync ended: releasing ${[...held].join(", ")}`,
      );
      deliver({
        change:
          held === "unknown" ? { kind: "unknown" } : { kind: "paths", paths: [...held].toSorted() },
        source: "pulled",
      });
    },
    remote: args.remote,
    root,
  };
  if (args.externalSync !== undefined) {
    gitArgs.externalSync = args.externalSync;
  }
  const git = createGitEngine(gitArgs);
  engine = git;

  // once per folder: every client re-walks the vault on each files-changed.
  const reportedUnreadable = new Set<string>();
  const serviceArgs: VaultServiceArgs = {
    ignore: ignore.current,
    lock: async (work) => await git.runExclusive(work),
    onMutated: (mutations) => {
      deliver({ mutations, source: "self" });
    },
    onUnreadableFolder: (relPath, code) => {
      if (reportedUnreadable.has(relPath)) {
        return;
      }
      reportedUnreadable.add(relPath);
      console.warn(`vault: ${relPath} cannot be read (${code}); listing it empty`);
    },
    root,
  };
  if (args.stallRead !== undefined) {
    serviceArgs.stallRead = args.stallRead;
  }
  const service = createVaultService(serviceArgs);

  let disposed = false;
  const deliverWatched = async (paths: readonly string[]): Promise<void> => {
    // stripped first: saves land mid-pass while the network steps run, and their echoes would
    // otherwise ride every pass's drain.
    const external = await stripSelfEchoes(paths);
    if (disposed || external.length === 0) {
      return;
    }
    if (gitIsSyncing()) {
      args.debugLog?.(`held until the vault sync ends: ${external.join(", ")}`);
      holdDuringSync({ kind: "paths", paths: external });
      return;
    }
    args.debugLog?.(`delivered: ${external.join(", ")}`);
    deliver({ paths: external, source: "watched" });
  };

  let watcher: VaultWatcher | null = null;
  if (args.watch ?? true) {
    const watcherArgs: VaultWatcherArgs = {
      debugLog: args.debugLog,
      ignores: (relPath) => ignore.settled().ignoresChangedPath(relPath),
      onChanged: (paths) => {
        void deliverWatched(paths);
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
      disposed = true;
      await watcher?.dispose();
      await git.dispose();
    },
    git,
    service,
  };
};
