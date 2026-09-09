// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// type-only: importing the types never loads the native addon, so the parent stays parcel-free
// and an inotify EINTR leak/hang is confined to the forked child.
import type * as ParcelWatcher from "@parcel/watcher";

type ParcelWatcherModule = typeof ParcelWatcher;
type ParcelWatcherSubscribe = ParcelWatcherModule["subscribe"];
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];

export type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];
export type ParcelWatcherSubscribeOptions = Parameters<ParcelWatcherSubscribe>[2];
export type ParcelAsyncSubscription = Awaited<ReturnType<ParcelWatcherSubscribe>>;
export type ParcelWatcherError = Parameters<ParcelWatcherCallback>[0];

export interface ParcelWatcherBackend {
  subscribe: (
    dir: string,
    callback: (error: ParcelWatcherError, events: ParcelWatcherEventBatch) => void,
    opts?: ParcelWatcherSubscribeOptions,
  ) => Promise<ParcelAsyncSubscription>;
}

export const toWatchErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message.trim().length > 0 ? cause.message : "Unknown watch error";
