// what a running turn has streamed so far: the deltas the store drops, folded per item until the
// item/completed that carries their final text lands. held in memory alone and never persisted,
// so a relaunch starts empty: an item is folded only once this process saw it start, since a fold
// from the middle of an item would draw its tail as the whole reply.

import { isThreadEventDelta } from "@repo/domain/provider-event";
import type { ThreadEvent, ThreadEventDelta } from "@repo/domain/provider-event";
import type { ThreadDisplayItem } from "./thread-projection";

// the rows a running turn draws before they settle, shaped as the settled rows they become
export type LiveItem = Extract<ThreadDisplayItem, { kind: "agent" | "reasoning" }>;

interface Streaming {
  kind: LiveItem["kind"];
  turnId: string;
  text: string;
}

export interface LiveTurns {
  // rows in log order, as a page landed them
  apply: (events: readonly ThreadEvent[]) => void;
  // a sign-in, a sign-out or a revocation: whatever streamed belongs to the log that is gone
  reset: () => void;
  snapshot: (threadId: string) => readonly LiveItem[];
  subscribe: (onChange: () => void) => () => void;
}

const NONE: readonly LiveItem[] = [];

// the settled reasoning row is trimmed, so the live one is too
const liveItem = (id: string, item: Streaming): LiveItem | null => {
  const text = item.kind === "reasoning" ? item.text.trim() : item.text;
  return text === "" ? null : { id, kind: item.kind, text };
};

const started = (event: Extract<ThreadEvent, { type: "item/started" }>): Streaming | null => {
  const { item } = event;
  const { turnId } = event.scope;
  if (item.type === "agentMessage") {
    return { kind: "agent", text: item.text, turnId };
  }
  if (item.type === "reasoning") {
    return { kind: "reasoning", text: item.text, turnId };
  }
  return null;
};

const DELTA_KIND = {
  "item/agentMessage/delta": "agent",
  "item/reasoning/textDelta": "reasoning",
} satisfies Record<ThreadEventDelta["type"], LiveItem["kind"]>;

// the next state of one item for one delta, or null when the delta is not this item's to fold
const folded = (item: Streaming, event: ThreadEventDelta): Streaming | null =>
  DELTA_KIND[event.type] === item.kind ? { ...item, text: item.text + event.delta } : null;

export const createLiveTurns = (): LiveTurns => {
  // per thread, per item id, in the order the items started
  const threads = new Map<string, Map<string, Streaming>>();
  const snapshots = new Map<string, readonly LiveItem[]>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const start = (event: Extract<ThreadEvent, { type: "item/started" }>): boolean => {
    const item = started(event);
    if (item === null) {
      return false;
    }
    const items = threads.get(event.threadId) ?? new Map<string, Streaming>();
    items.set(event.item.id, item);
    threads.set(event.threadId, items);
    return true;
  };

  const endTurn = (event: Extract<ThreadEvent, { type: "turn/completed" }>): boolean => {
    const items = threads.get(event.threadId);
    if (items === undefined) {
      return false;
    }
    const ending = [...items].filter(([, item]) => item.turnId === event.scope.turnId);
    for (const [id] of ending) {
      items.delete(id);
    }
    return ending.length > 0;
  };

  const grow = (event: ThreadEventDelta): boolean => {
    const items = threads.get(event.threadId);
    const item = items?.get(event.itemId);
    const next = item === undefined ? null : folded(item, event);
    if (items === undefined || next === null) {
      return false;
    }
    items.set(event.itemId, next);
    return true;
  };

  // true when the event moved what the thread draws
  const fold = (event: ThreadEvent): boolean => {
    if (event.type === "item/started") {
      return start(event);
    }
    if (event.type === "item/completed") {
      return threads.get(event.threadId)?.delete(event.item.id) ?? false;
    }
    if (event.type === "turn/completed") {
      return endTurn(event);
    }
    return isThreadEventDelta(event) && grow(event);
  };

  return {
    apply(events) {
      const moved = new Set<string>();
      for (const event of events) {
        if (fold(event)) {
          moved.add(event.threadId);
        }
      }
      if (moved.size === 0) {
        return;
      }
      for (const threadId of moved) {
        snapshots.delete(threadId);
        if (threads.get(threadId)?.size === 0) {
          threads.delete(threadId);
        }
      }
      notify();
    },

    reset() {
      if (threads.size === 0) {
        return;
      }
      threads.clear();
      snapshots.clear();
      notify();
    },

    // cached until the thread moves: useSyncExternalStore reads a fresh array as new state
    snapshot(threadId) {
      const cached = snapshots.get(threadId);
      if (cached !== undefined) {
        return cached;
      }
      const items = threads.get(threadId);
      const snapshot =
        items === undefined
          ? NONE
          : [...items].flatMap(([id, item]) => {
              const live = liveItem(id, item);
              return live === null ? [] : [live];
            });
      snapshots.set(threadId, snapshot);
      return snapshot;
    },

    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
};
