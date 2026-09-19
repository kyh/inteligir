// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import path from "node:path";
import type {
  ParcelAsyncSubscription,
  ParcelWatcherBackend,
  ParcelWatcherEventBatch,
} from "./parcel-backend";
import { toWatchErrorMessage } from "./parcel-backend";
import type { ChildToParentMessage, ParentToChildMessage, SerializedParcelEvent } from "./messages";

const serializeEvents = (events: ParcelWatcherEventBatch): SerializedParcelEvent[] =>
  events.map((event) => ({ path: event.path, type: event.type }));

export interface ParcelChildHandler {
  handleMessage: (message: ParentToChildMessage) => void;
  dispose: () => Promise<void>;
}

export const createParcelChildHandler = (args: {
  parcel: ParcelWatcherBackend;
  send: (message: ChildToParentMessage) => void;
  listEntries: (dir: string) => Promise<string[]>;
}): ParcelChildHandler => {
  const subscriptions = new Map<string, ParcelAsyncSubscription>();
  // ids unsubscribed before their subscribe() resolved: torn down on arrival rather than leaked.
  const cancelledBeforeReady = new Set<string>();

  const emitRescan = async (id: string, dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await args.listEntries(dir);
    } catch {
      return;
    }
    if (entries.length === 0) {
      return;
    }
    args.send({
      events: entries.map((entry) => ({
        path: path.join(dir, entry),
        type: "update",
      })),
      id,
      kind: "events",
    });
  };

  const handleSubscribe = (message: Extract<ParentToChildMessage, { kind: "subscribe" }>): void => {
    void (async () => {
      let subscription: ParcelAsyncSubscription;
      try {
        subscription = await args.parcel.subscribe(
          message.dir,
          (error, events) => {
            if (error) {
              args.send({
                id: message.id,
                kind: "watch-error",
                message: toWatchErrorMessage(error),
              });
              return;
            }
            args.send({
              events: serializeEvents(events),
              id: message.id,
              kind: "events",
            });
          },
          message.opts,
        );
      } catch (error) {
        cancelledBeforeReady.delete(message.id);
        args.send({
          id: message.id,
          kind: "subscribe-failed",
          message: toWatchErrorMessage(error),
        });
        return;
      }
      if (cancelledBeforeReady.delete(message.id)) {
        try {
          await subscription.unsubscribe();
        } catch {
          // cancelled before it was ever reported; nothing to tell the parent.
        }
        return;
      }
      subscriptions.set(message.id, subscription);
      args.send({ id: message.id, kind: "subscribed" });
      if (message.rescan) {
        await emitRescan(message.id, message.dir);
      }
    })();
  };

  const handleUnsubscribe = async (id: string): Promise<void> => {
    const subscription = subscriptions.get(id);
    if (subscription) {
      subscriptions.delete(id);
      try {
        await subscription.unsubscribe();
      } catch {
        // Ignore unsubscribe failures during teardown.
      }
    } else {
      cancelledBeforeReady.add(id);
    }
    args.send({ id, kind: "unsubscribed" });
  };

  return {
    async dispose() {
      const pending = [...subscriptions.values()];
      subscriptions.clear();
      cancelledBeforeReady.clear();
      await Promise.all(
        pending.map(async (subscription) => {
          await subscription.unsubscribe().catch(() => {
            /* empty */
          });
        }),
      );
    },
    handleMessage(message) {
      switch (message.kind) {
        case "subscribe": {
          handleSubscribe(message);
          break;
        }
        case "unsubscribe": {
          void handleUnsubscribe(message.id);
          break;
        }
        case "ping": {
          args.send({ kind: "pong" });
          break;
        }
        // no default
      }
    },
  };
};
