// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// Type-only handle on the @parcel/watcher module. Importing the *types* never
// loads the native addon, so the parent process stays parcel-free — the native
// backend, and thus any inotify EINTR leak/hang, is confined to the forked
// child (parcel-child-entry.ts).
type ParcelWatcherModule = typeof import("@parcel/watcher");
type ParcelWatcherSubscribe = ParcelWatcherModule["subscribe"];
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];

export type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];
export type ParcelWatcherSubscribeOptions = Parameters<ParcelWatcherSubscribe>[2];
export type ParcelAsyncSubscription = Awaited<ReturnType<ParcelWatcherSubscribe>>;
export type ParcelWatcherError = Parameters<ParcelWatcherCallback>[0];

/**
 * The minimal slice of the @parcel/watcher API the vault watcher uses. The
 * subprocess proxy implements it for production; tests may pass the real
 * in-process module or a fake.
 */
export interface ParcelWatcherBackend {
  subscribe(
    dir: string,
    callback: (error: ParcelWatcherError, events: ParcelWatcherEventBatch) => void,
    opts?: ParcelWatcherSubscribeOptions,
  ): Promise<ParcelAsyncSubscription>;
}

export function toWatchErrorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : "Unknown watch error";
}
