// What a device shows of the account's library, kept by the account's socket: every read is a
// TanStack query under oRPC's key, so a moved frame marks stale the queries over what it names, and
// the socket coming up marks every one, since a drop or a deploy may have hidden a write meanwhile.
// An item's read goes again only when the copy held is older than the sequence the frame names, so
// a note's typing reads its row again only when it changed what a row holds. A screen hears which
// items moved, and the reply the agent is writing, until a write moves its thread or the socket
// goes down.

import type { RouterUtils } from "@orpc/tanstack-query";
import type { QueryClient } from "@tanstack/query-core";

import { sharedFailure } from "@repo/contract/library/call-outcome";
import type { MovedFrame } from "@repo/contract/library/library-socket";
import type { V1Client } from "@repo/contract/v1";

import { createAccountSocket } from "./account-socket";
import type { AccountSocket, WebSocketClass } from "./account-socket";

export type V1Queries = RouterUtils<V1Client>;

// the items a write moved, or null when any may have
export type ItemsMoved = ReadonlySet<string> | null;

// the text so far of the reply the agent is writing in a thread; or none any more (null) in a
// thread a write moved, since its reply landed or its turn moved on, or in every thread
// (`threadId` null) when the write moved more than a frame names or the socket went down
type ThreadPreview =
  | { readonly threadId: string; readonly text: string }
  | { readonly threadId: string | null; readonly text: null };

// the reply being written, never stored and never read back, for a screen that reads it as an
// external store
export interface ThreadPreviews {
  // the text so far of the reply the agent is writing in `threadId`, null while it writes none
  readonly get: (threadId: string) => string | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly hear: (preview: ThreadPreview) => void;
}

export interface LibrarySocket extends AccountSocket {
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
  readonly previews: ThreadPreviews;
}

interface LibrarySocketArgs {
  readonly client: V1Client;
  readonly queries: V1Queries;
  readonly queryClient: QueryClient;
  readonly origin: string;
  readonly WebSocket?: WebSocketClass;
}

const QUERY_TRIES = 3;

// a call the cloud did not answer, or answered busy, is asked again; a refusal never is, since it
// answers the same however often it is asked
export const retryUnlessRefused = (failures: number, cause: Error): boolean => {
  const kind = sharedFailure(cause)?.kind;
  return failures < QUERY_TRIES && (kind === "unreachable" || kind === "busy");
};

export const createThreadPreviews = (): ThreadPreviews => {
  const texts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const changed = (preview: ThreadPreview): boolean => {
    if (preview.text !== null) {
      if (texts.get(preview.threadId) === preview.text) {
        return false;
      }
      texts.set(preview.threadId, preview.text);
      return true;
    }
    if (preview.threadId === null) {
      const held = texts.size > 0;
      texts.clear();
      return held;
    }
    return texts.delete(preview.threadId);
  };
  return {
    get: (threadId) => texts.get(threadId) ?? null,
    hear: (preview) => {
      if (!changed(preview)) {
        return;
      }
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const invalidateMoved = (
  { library }: V1Queries,
  queryClient: QueryClient,
  frame: MovedFrame,
): ItemsMoved => {
  let moved: ItemsMoved = new Set();
  if (frame.items === "all") {
    moved = null;
    void queryClient.invalidateQueries({ queryKey: library.items.row.key() });
    void queryClient.invalidateQueries({ queryKey: library.items.get.key() });
    void queryClient.invalidateQueries({ queryKey: library.listing.key() });
  } else if (frame.items.length > 0) {
    moved = new Set(frame.items.map(({ id }) => id));
    for (const { id, seq } of frame.items) {
      const row = library.items.row.queryKey({ input: { id } });
      if ((queryClient.getQueryData(row)?.seq ?? -1) < seq) {
        void queryClient.invalidateQueries({ exact: true, queryKey: row });
      }
      const whole = library.items.get.queryKey({ input: { id } });
      if ((queryClient.getQueryData(whole)?.seq ?? -1) < seq) {
        void queryClient.invalidateQueries({ exact: true, queryKey: whole });
      }
    }
    void queryClient.invalidateQueries({ queryKey: library.listing.key() });
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
  client,
  queries,
  queryClient,
  origin,
  WebSocket,
}: LibrarySocketArgs): LibrarySocket => {
  const itemListeners = new Set<(moved: ItemsMoved) => void>();
  const itemsMoved = (moved: ItemsMoved): void => {
    for (const listener of itemListeners) {
      listener(moved);
    }
  };
  const previews = createThreadPreviews();
  const socket = createAccountSocket({
    onFrame: (frame) => {
      if (frame.type === "preview") {
        previews.hear({ text: frame.text, threadId: frame.threadId });
        return;
      }
      const moved = invalidateMoved(queries, queryClient, frame);
      if (moved === null || moved.size > 0) {
        itemsMoved(moved);
      }
      for (const threadId of frame.threads === "all" ? [null] : frame.threads) {
        previews.hear({ text: null, threadId });
      }
    },
    // down: no frame can let a preview go any more, and a reply still being written sends its
    // next one within a moment of the next up, by when any write may have landed unsaid
    onStatus: (status) => {
      if (status === "down") {
        previews.hear({ text: null, threadId: null });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queries.key() });
      itemsMoved(null);
    },
    origin,
    ticket: async () => {
      const { ticket } = await client.account.socketTicket();
      return ticket;
    },
    WebSocket,
  });
  return {
    ...socket,
    onItems: (listener) => {
      itemListeners.add(listener);
      return () => {
        itemListeners.delete(listener);
      };
    },
    previews,
  };
};
