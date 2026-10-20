import type { ParcelWatcherBackend, ParcelWatcherEventBatch } from "../watcher/parcel-backend";

// a watcher backend that reports exactly what the test emits, so an echo can be staged without
// waiting on the platform's own events.
export const scriptedWatcher = () => {
  let deliver: ((events: ParcelWatcherEventBatch) => void) | null = null;
  const backend: ParcelWatcherBackend = {
    subscribe: async (_dir, listener) => {
      deliver = (events) => {
        listener(null, events);
      };
      return await Promise.resolve({
        unsubscribe: async () => {
          await Promise.resolve();
        },
      });
    },
  };
  return {
    backend,
    emit: (...absolutePaths: string[]) => {
      deliver?.(absolutePaths.map((absolutePath) => ({ path: absolutePath, type: "update" })));
    },
  };
};
