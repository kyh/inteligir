// snapshots are cached and rebuilt only on change: useSyncExternalStore treats a fresh reference as
// new state.

import type {
  ApplyThreadEventsArgs,
  StoredThread,
  StoredThreadEvent,
  SyncStore,
} from "./sync-store";
import { isThreadEventDelta } from "@repo/domain/provider-event";

export const createMemorySyncStore = (): SyncStore => {
  let cursor = 0;
  const threads = new Map<string, StoredThread>();

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
      const current = threads.get(args.threadId);
      const appended: StoredThreadEvent[] = [];
      let lastSeq = current?.lastSeq ?? 0;
      let changed = false;
      for (const row of args.rows) {
        // the log and its cursor move together, so a row at or below the cursor was applied or
        // skipped already.
        if (row.seq <= cursor) {
          continue;
        }
        changed = true;
        lastSeq = Math.max(lastSeq, row.seq);
        if (!isThreadEventDelta(row.event)) {
          appended.push(row.event);
        }
      }
      // the cursor moves with the append: one synchronous call is the whole transaction.
      cursor = Math.max(cursor, args.cursor);
      if (!changed) {
        return;
      }
      // a snapshot is never mutated, so a step that appends copies once; a step of deltas alone
      // keeps the array and only moves the thread's recency.
      const held = current?.events ?? [];
      threads.set(args.threadId, {
        events: appended.length === 0 ? held : [...held, ...appended],
        lastSeq,
        threadId: args.threadId,
      });
      notifyThreads();
    },

    readCursor(): number {
      return cursor;
    },

    reset(): void {
      cursor = 0;
      threads.clear();
      notifyThreads();
    },

    snapshotThread(threadId: string): StoredThread | null {
      return threads.get(threadId) ?? null;
    },

    snapshotThreads(): readonly StoredThread[] {
      threadsSnapshot ??= [...threads.values()].toSorted((a, b) => b.lastSeq - a.lastSeq);
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
