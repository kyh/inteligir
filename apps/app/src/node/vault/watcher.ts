// The vault's one filesystem watch: external edits (another app, a git pull)
// become debounced change batches. The native watcher runs in a forked child
// (see watcher/) so a native-addon failure can be SIGKILLed and respawned
// without taking the server down.

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";
import { createForkChannel } from "./watcher/fork-channel";
import type { ParcelAsyncSubscription, ParcelWatcherBackend } from "./watcher/parcel-backend";
import { toWatchErrorMessage } from "./watcher/parcel-backend";
import { createParcelWatcherProxy, type ParcelWatcherProxy } from "./watcher/parcel-watcher-proxy";
import { isIgnoredEntryName } from "./vault-paths";

const DEBOUNCE_MS = 200;
const MAX_WAIT_MS = 1_000;
const RESUBSCRIBE_BASE_DELAY_MS = 500;
const RESUBSCRIBE_MAX_DELAY_MS = 30_000;

export interface VaultWatcherArgs {
  /** Absolute vault root; must exist before start(). */
  root: string;
  /** Vault-relative paths that changed, deduplicated, after the debounce window. */
  onChanged: (paths: readonly string[]) => void;
  onError?: (message: string) => void;
  /** Tests inject the in-process @parcel/watcher module or a fake; production
   *  defaults to the forked-child proxy. */
  backend?: ParcelWatcherBackend;
}

export interface VaultWatcher {
  start(): void;
  dispose(): Promise<void>;
}

export function createVaultWatcher(args: VaultWatcherArgs): VaultWatcher {
  // realpath, not resolve: FSEvents reports paths with symlinks expanded
  // (macOS /var → /private/var), and a root that kept the symlink spelling
  // would make every event compute as outside the vault.
  const root = realpathSync(resolve(args.root));

  let ownedProxy: ParcelWatcherProxy | null = null;
  const backend =
    args.backend ??
    (() => {
      ownedProxy = createParcelWatcherProxy({ spawnChannel: createForkChannel });
      return ownedProxy;
    })();

  let disposed = false;
  let subscription: ParcelAsyncSubscription | null = null;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const pendingPaths = new Set<string>();
  const scheduler = createDebouncedCallbackScheduler({
    debounceMs: DEBOUNCE_MS,
    maxWaitMs: MAX_WAIT_MS,
    onFlush: () => {
      if (disposed || pendingPaths.size === 0) {
        return;
      }
      const paths = [...pendingPaths].toSorted();
      pendingPaths.clear();
      args.onChanged(paths);
    },
  });

  function toVaultRelativePath(absPath: string): string | null {
    const rel = relative(root, absPath);
    // A bare startsWith("..") would also eat a legal root entry named
    // "..draft.md" — outside-the-root is exactly these three shapes.
    if (rel.length === 0 || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      return null;
    }
    const segments = rel.split(sep);
    if (segments.some((segment) => isIgnoredEntryName(segment))) {
      return null;
    }
    return segments.join("/");
  }

  function scheduleResubscribe(): void {
    if (disposed || retryTimer !== null) {
      return;
    }
    const delay = Math.min(RESUBSCRIBE_BASE_DELAY_MS * 2 ** retryAttempt, RESUBSCRIBE_MAX_DELAY_MS);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start();
    }, delay);
    retryTimer.unref?.();
  }

  function start(): void {
    if (disposed || subscription !== null) {
      return;
    }
    void (async () => {
      let established: ParcelAsyncSubscription;
      try {
        established = await backend.subscribe(
          root,
          (error, events) => {
            if (disposed) {
              return;
            }
            if (error) {
              // The proxy self-heals backend deaths; an error surfacing here
              // is an establish failure, so back off and re-subscribe.
              args.onError?.(toWatchErrorMessage(error));
              subscription = null;
              scheduleResubscribe();
              return;
            }
            for (const event of events) {
              const rel = toVaultRelativePath(event.path);
              if (rel !== null) {
                pendingPaths.add(rel);
              }
            }
            if (pendingPaths.size > 0) {
              scheduler.schedule();
            }
          },
          { ignore: [".git"] },
        );
      } catch (error) {
        if (disposed) {
          return;
        }
        args.onError?.(toWatchErrorMessage(error));
        scheduleResubscribe();
        return;
      }
      if (disposed) {
        void established.unsubscribe().catch(() => {});
        return;
      }
      retryAttempt = 0;
      subscription = established;
    })();
  }

  return {
    start,
    async dispose() {
      disposed = true;
      scheduler.dispose();
      pendingPaths.clear();
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const established = subscription;
      subscription = null;
      if (established !== null) {
        await established.unsubscribe().catch(() => {});
      }
      ownedProxy?.dispose();
    },
  };
}
