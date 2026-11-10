// The account's socket as this page hears it (`@repo/contract/library/account-socket`): a
// hint, never the state. A moved frame invalidates the queries over what it names, an item's row
// only when the copy held is older than the sequence it names, and every time the socket comes up
// everything is invalidated, since a drop or a deploy may have hidden a write meanwhile. A note's
// typing moves its item only when it changes what a row holds (the card, the links, the tags or
// the files), so a row is read again that often and no more. The editor's embeds hear which items
// moved, and the agent panel the reply being written, until a write moves its thread or the
// socket goes down.

import { createSocketHint } from "@repo/contract/library/account-socket";
import type { Clock, SocketDial, SocketHint } from "@repo/contract/library/account-socket";
import type { MovedFrame } from "@repo/contract/library/library-socket";
import { onlineManager } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { CloudWire } from "./v1";

// items that moved, each at the sequence it now holds, or null when any may have
/** @internal */
export type ItemsMoved = ReadonlyMap<string, number> | null;

// the reply the agent is writing in a thread, its text so far; or none any more (null) in a
// thread a write moved, since its reply landed or its turn moved on, or in every thread
// (`threadId` null) when the write moved more than a frame names or the socket went down
/** @internal */
export type ThreadPreview =
  | { readonly threadId: string; readonly text: string }
  | { readonly threadId: string | null; readonly text: null };

export interface LibrarySocket extends SocketHint {
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
  readonly onPreview: (listener: (preview: ThreadPreview) => void) => () => void;
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
    void queryClient.invalidateQueries({ queryKey: library.items.row.key() });
    void queryClient.invalidateQueries({ queryKey: library.listing.key() });
  } else if (frame.items.length > 0) {
    moved = new Map(frame.items.map(({ id, seq }) => [id, seq]));
    for (const { id, seq } of frame.items) {
      const queryKey = library.items.row.queryKey({ input: { id } });
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
  const previews = listenersOf<ThreadPreview>();
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
          for (const threadId of frame.threads === "all" ? [null] : frame.threads) {
            previews.tell({ text: null, threadId });
          }
          break;
        }
        case "preview": {
          previews.tell({ text: frame.text, threadId: frame.threadId });
          break;
        }
        // no default
      }
    },
    // down: no frame can let a preview go any more, and a reply still being written sends its
    // next one within a moment of the next up, by when any write may have landed unsaid
    onStatus: (status) => {
      if (status === "down") {
        previews.tell({ text: null, threadId: null });
        return;
      }
      void queryClient.invalidateQueries();
      items.tell(null);
    },
    origin,
    ticket: async () => {
      const { ticket } = await wire.client.account.socketTicket();
      return ticket;
    },
  });
  return { ...hint, onItems: items.add, onPreview: previews.add };
};

// dialled while the page shows the library and the browser says it is online: at once when it
// comes back rather than at the next wait of its backoff, and never while it is offline
export const useLibrarySocket = (socket: LibrarySocket): void => {
  useEffect(() => {
    const reach = (online: boolean): void => {
      if (online) {
        socket.online();
      } else {
        socket.offline();
      }
    };
    reach(onlineManager.isOnline());
    socket.connect();
    const stop = onlineManager.subscribe(reach);
    return () => {
      stop();
      socket.close();
    };
  }, [socket]);
};
