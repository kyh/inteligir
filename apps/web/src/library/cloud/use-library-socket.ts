// The account's socket as this page hears it (`@repo/contract/library/account-socket`): a
// hint, never the state. A moved frame invalidates the queries over what it names, an item only when
// the copy held is older than the sequence it names, and every time the socket opens everything is
// invalidated, since a drop or a deploy may have hidden a write meanwhile. The open item and the
// editor's embeds hear which items moved, and the agent panel every thread frame.

import { createSocketHint } from "@repo/contract/library/account-socket";
import type { Clock, SocketDial } from "@repo/contract/library/account-socket";
import type { MovedFrame } from "@repo/contract/library/library-socket";
import type { ThreadFrame } from "@repo/agent-panel/thread-previews";
import { onlineManager } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { CloudWire } from "./v1";

// items that moved, each at the sequence it now holds, or null when any may have
/** @internal */
export type ItemsMoved = ReadonlyMap<string, number> | null;

export interface LibrarySocket {
  readonly connect: () => void;
  readonly close: () => void;
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
  readonly onThread: (listener: (frame: ThreadFrame) => void) => () => void;
}

interface LibrarySocketArgs {
  readonly wire: CloudWire;
  readonly queryClient: QueryClient;
  readonly origin: string;
  readonly clock: Clock;
  readonly dial: SocketDial;
}

const listenersOf = <T>() => {
  const listeners = new Set<(value: T) => void>();
  return {
    add: (listener: (value: T) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tell: (value: T): void => {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
};

const invalidateMoved = (
  { orpc }: Pick<CloudWire, "orpc">,
  queryClient: QueryClient,
  frame: MovedFrame,
): ItemsMoved => {
  const { library } = orpc;
  let moved: ItemsMoved = null;
  if (frame.items === "all") {
    void queryClient.invalidateQueries({ queryKey: library.items.get.key() });
    void queryClient.invalidateQueries({ queryKey: library.listing.key() });
  } else if (frame.items.length > 0) {
    moved = new Map(frame.items.map(({ id, seq }) => [id, seq]));
    for (const { id, seq } of frame.items) {
      const queryKey = library.items.get.queryKey({ input: { id } });
      if ((queryClient.getQueryData(queryKey)?.seq ?? -1) < seq) {
        void queryClient.invalidateQueries({ exact: true, queryKey });
      }
    }
    void queryClient.invalidateQueries({ queryKey: library.listing.key() });
  } else {
    moved = new Map();
  }
  if (frame.folders) {
    void queryClient.invalidateQueries({ queryKey: library.listing.scopes.key() });
  }
  const { threads } = frame;
  if (threads === "all" || threads.length > 0) {
    void queryClient.invalidateQueries({ queryKey: library.agent.list.key() });
    void queryClient.invalidateQueries({ queryKey: library.history.key() });
    if (threads === "all") {
      void queryClient.invalidateQueries({ queryKey: library.agent.events.key() });
    }
    for (const threadId of threads === "all" ? [] : threads) {
      void queryClient.invalidateQueries({
        queryKey: library.agent.events.key({ input: { threadId } }),
      });
    }
  }
  return moved;
};

export const createLibrarySocket = ({
  wire,
  queryClient,
  origin,
  clock,
  dial,
}: LibrarySocketArgs): LibrarySocket => {
  const items = listenersOf<ItemsMoved>();
  const threads = listenersOf<ThreadFrame>();
  const hint = createSocketHint({
    clock,
    dial,
    onFrame: (frame) => {
      switch (frame.type) {
        case "moved": {
          const moved = invalidateMoved(wire, queryClient, frame);
          if (moved === null || moved.size > 0) {
            items.tell(moved);
          }
          break;
        }
        case "thread": {
          if (!frame.preview) {
            void queryClient.invalidateQueries({
              queryKey: wire.orpc.library.agent.events.key({ input: { threadId: frame.threadId } }),
            });
          }
          threads.tell(frame);
          break;
        }
        // no default
      }
    },
    onOpen: () => {
      void queryClient.invalidateQueries();
      items.tell(null);
    },
    origin,
    ticket: async () => {
      try {
        const { ticket } = await wire.client.account.socketTicket();
        return ticket;
      } catch {
        return null;
      }
    },
  });
  return { ...hint, onItems: items.add, onThread: threads.add };
};

// dialled while the page shows the library, and at once when the browser says it is back online
// rather than at the next wait of its backoff
export const useLibrarySocket = (socket: LibrarySocket): void => {
  useEffect(() => {
    socket.connect();
    const stop = onlineManager.subscribe((online) => {
      if (online) {
        socket.connect();
      }
    });
    return () => {
      stop();
      socket.close();
    };
  }, [socket]);
};
