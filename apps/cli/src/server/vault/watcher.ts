import { realpathSync } from "node:fs";
import path from "node:path";
import { isIgnoredEntryName } from "@repo/notes/knowledge/vault-path";
import type { DebugLog } from "../debug-log";
import { relativeUnder } from "../path-containment";
import { createDebouncedCallbackScheduler } from "./watcher/debounce";
import { createForkChannel } from "./watcher/fork-channel";
import type { ParcelAsyncSubscription, ParcelWatcherBackend } from "./watcher/parcel-backend";
import { toWatchErrorMessage } from "./watcher/parcel-backend";
import { createParcelWatcherProxy } from "./watcher/parcel-watcher-proxy";
import type { ChildChannel, ParcelWatcherProxy } from "./watcher/parcel-watcher-proxy";

const DEBOUNCE_MS = 200;
const MAX_WAIT_MS = 1000;
const RESUBSCRIBE_BASE_DELAY_MS = 500;
const RESUBSCRIBE_MAX_DELAY_MS = 30_000;

export interface VaultWatcherArgs {
  root: string;
  // asked per event, so a reload of the rules reaches the next batch
  ignores: (relPath: string) => boolean;
  onChanged: (paths: readonly string[]) => void;
  onError?: (message: string) => void;
  backend?: ParcelWatcherBackend;
  // how the proxy starts its child; absent, node forks it
  spawnChannel?: () => ChildChannel;
  debugLog?: DebugLog | undefined;
}

export interface VaultWatcher {
  start: () => void;
  dispose: () => Promise<void>;
}

export const createVaultWatcher = (args: VaultWatcherArgs): VaultWatcher => {
  // realpath, not resolve: fsevents reports paths with symlinks expanded (macos /var →
  // /private/var), so a root keeping the symlink spelling computes every event as outside.
  const root = realpathSync(path.resolve(args.root));

  let ownedProxy: ParcelWatcherProxy | null = null;
  const backend =
    args.backend ??
    (() => {
      ownedProxy = createParcelWatcherProxy({
        spawnChannel: args.spawnChannel ?? createForkChannel,
      });
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
      args.debugLog?.(`flush ${paths.length} path(s): ${paths.join(", ")}`);
      args.onChanged(paths);
    },
  });

  const eventVerdict = (
    absPath: string,
  ): { kind: "kept"; path: string } | { kind: "dropped"; why: string } => {
    const rel = relativeUnder(root, absPath);
    if (rel === null) {
      return { kind: "dropped", why: "not beneath the vault root" };
    }
    if (!args.ignores(rel)) {
      return { kind: "kept", path: rel };
    }
    const entry = rel.split("/").find((segment) => isIgnoredEntryName(segment));
    return {
      kind: "dropped",
      why: entry === undefined ? "ignored by a .gitignore" : `under ignored entry ${entry}`,
    };
  };

  const scheduleResubscribe = (retry: () => void): void => {
    if (disposed || retryTimer !== null) {
      return;
    }
    const delay = Math.min(RESUBSCRIBE_BASE_DELAY_MS * 2 ** retryAttempt, RESUBSCRIBE_MAX_DELAY_MS);
    retryAttempt += 1;
    args.debugLog?.(`resubscribing in ${delay}ms (attempt ${retryAttempt})`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retry();
    }, delay);
    retryTimer.unref?.();
  };

  const start = (): void => {
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
              scheduleResubscribe(start);
              return;
            }
            // the first proof the watch is live: the proxy resolves a subscribe at once and
            // reports a failed establish later, through this callback.
            retryAttempt = 0;
            for (const event of events) {
              const verdict = eventVerdict(event.path);
              if (verdict.kind === "kept") {
                pendingPaths.add(verdict.path);
              }
              args.debugLog?.(
                verdict.kind === "kept"
                  ? `${event.type} ${verdict.path}: kept`
                  : `${event.type} ${event.path}: dropped, ${verdict.why}`,
              );
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
        scheduleResubscribe(start);
        return;
      }
      if (disposed) {
        try {
          await established.unsubscribe();
        } catch {
          // already torn down; nothing to report.
        }
        return;
      }
      subscription = established;
    })();
  };

  return {
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
        await established.unsubscribe().catch(() => {
          /* empty */
        });
      }
      ownedProxy?.dispose();
    },
    start,
  };
};
