import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { isIgnoredEntryName } from "@repo/notes/knowledge/vault-path";
import { relativeUnder } from "../path-containment";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";
import { createForkChannel } from "./watcher/fork-channel";
import type { ParcelAsyncSubscription, ParcelWatcherBackend } from "./watcher/parcel-backend";
import { toWatchErrorMessage } from "./watcher/parcel-backend";
import { createParcelWatcherProxy, type ParcelWatcherProxy } from "./watcher/parcel-watcher-proxy";

const DEBOUNCE_MS = 200;
const MAX_WAIT_MS = 1_000;
const RESUBSCRIBE_BASE_DELAY_MS = 500;
const RESUBSCRIBE_MAX_DELAY_MS = 30_000;

export interface VaultWatcherArgs {
  root: string;
  onChanged: (paths: readonly string[]) => void;
  onError?: (message: string) => void;
  backend?: ParcelWatcherBackend;
}

export interface VaultWatcher {
  start(): void;
  dispose(): Promise<void>;
}

export function createVaultWatcher(args: VaultWatcherArgs): VaultWatcher {
  // realpath, not resolve: fsevents reports paths with symlinks expanded (macos /var →
  // /private/var), so a root keeping the symlink spelling computes every event as outside.
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
    const rel = relativeUnder(root, absPath);
    if (rel === null) {
      return null;
    }
    return rel.split("/").some((segment) => isIgnoredEntryName(segment)) ? null : rel;
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
              // the proxy self-heals backend deaths, so an error here is an establish failure.
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
