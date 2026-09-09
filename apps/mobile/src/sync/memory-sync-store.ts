// snapshots are cached and rebuilt only on change: useSyncExternalStore treats a fresh reference as
// new state.

import type { ApplyThreadEventsArgs, StoredThread, SyncStore } from "./sync-store";
import type { ThreadEvent } from "@repo/domain/provider-event";

interface ThreadState {
  events: ThreadEvent[];
  lastSeq: number;
  snapshot: StoredThread;
}

const originKey = (deviceId: string, deviceSeq: number): string => `${deviceId}:${deviceSeq}`;

const rebuildThreadSnapshot = (state: ThreadState, threadId: string): void => {
  state.snapshot = { events: [...state.events], lastSeq: state.lastSeq, threadId };
};

export const createMemorySyncStore = (): SyncStore => {
  let cursor = 0;
  const threads = new Map<string, ThreadState>();
  const appliedOrigins = new Set<string>();

  const threadListeners = new Set<() => void>();
  let threadsSnapshot: readonly StoredThread[] | null = null;

  const notifyThreads = (): void => {
    threadsSnapshot = null;
    for (const listener of threadListeners) {
      listener();
    }
  };

  return {
    applyThreadEvents(args: ApplyThreadEventsArgs): void {
      let changed = false;
      let state = threads.get(args.threadId);
      for (const row of args.rows) {
        const key = originKey(row.origin.deviceId, row.origin.deviceSeq);
        if (appliedOrigins.has(key)) {
          continue;
        }
        appliedOrigins.add(key);
        if (state === undefined) {
          state = {
            events: [],
            lastSeq: 0,
            snapshot: { events: [], lastSeq: 0, threadId: args.threadId },
          };
          threads.set(args.threadId, state);
        }
        state.events.push(row.event);
        state.lastSeq = Math.max(state.lastSeq, row.seq);
        changed = true;
      }
      // the cursor moves with the append: one synchronous call is the whole transaction.
      ({ cursor } = args);
      if (changed && state !== undefined) {
        rebuildThreadSnapshot(state, args.threadId);
        notifyThreads();
      }
    },

    readCursor(): number {
      return cursor;
    },

    reset(): void {
      cursor = 0;
      threads.clear();
      appliedOrigins.clear();
      notifyThreads();
    },

    snapshotThread(threadId: string): StoredThread | null {
      return threads.get(threadId)?.snapshot ?? null;
    },

    snapshotThreads(): readonly StoredThread[] {
      threadsSnapshot ??= [...threads.values()]
        .map((state) => state.snapshot)
        .toSorted((a, b) => b.lastSeq - a.lastSeq);
      return threadsSnapshot;
    },

    subscribeThreads(onChange: () => void): () => void {
      threadListeners.add(onChange);
      return () => {
        threadListeners.delete(onChange);
      };
    },

    writeCursor(seq: number): void {
      cursor = seq;
    },
  };
};
