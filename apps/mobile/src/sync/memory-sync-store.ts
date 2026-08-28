// The in-memory `SyncStore` — the v1 concrete storage, and the fake the unit
// suite drives.
//
// WHY IN-MEMORY IS THE V1 CHOICE, stated because the issue asks for it: the two
// stores must agree (see sync-store.ts), and the applied thread log is the one
// the UI reads. Persisting the cursor beside an in-memory log would claim rows
// the log never held; persisting the log needs expo-sqlite, which adds a native
// build step to a client whose whole job is to be a thin reader. So v1 keeps
// both in memory and rebuilds from the account log on launch — which is CORRECT,
// not degraded: a pull from cursor 0 re-applies idempotently (own rows skipped,
// every row deduped on its origin identity), so a cold start simply re-reads the
// account's history. The ONE durable thing in v1 is the device credential
// (expo-secure-store), because it is the sync switch and a secret. The durable
// follow-up is an expo-sqlite adapter that persists both together.
//
// Snapshot references are CACHED and rebuilt only on change, because
// `useSyncExternalStore` treats a fresh reference as new state — a snapshot
// rebuilt every render is an infinite loop.

import type { ApplyThreadEventsArgs, StoredThread, SyncStore } from "./sync-store";
import type { ThreadEvent } from "@repo/domain/provider-event";

interface ThreadState {
  events: ThreadEvent[];
  lastSeq: number;
  /** The stable snapshot the UI holds — rebuilt only when this thread changes. */
  snapshot: StoredThread;
}

function originKey(deviceId: string, deviceSeq: number): string {
  return `${deviceId}:${deviceSeq}`;
}

function rebuildThreadSnapshot(state: ThreadState, threadId: string): void {
  state.snapshot = { threadId, events: [...state.events], lastSeq: state.lastSeq };
}

export function createMemorySyncStore(): SyncStore {
  let cursor = 0;
  const threads = new Map<string, ThreadState>();
  const appliedOrigins = new Set<string>();

  const threadListeners = new Set<() => void>();
  let threadsSnapshot: readonly StoredThread[] | null = null;

  function notifyThreads(): void {
    threadsSnapshot = null;
    for (const listener of threadListeners) listener();
  }

  return {
    readCursor(): number {
      return cursor;
    },

    writeCursor(seq: number): void {
      cursor = seq;
    },

    applyThreadEvents(args: ApplyThreadEventsArgs): void {
      let changed = false;
      let state = threads.get(args.threadId);
      for (const row of args.rows) {
        const key = originKey(row.origin.deviceId, row.origin.deviceSeq);
        if (appliedOrigins.has(key)) continue;
        appliedOrigins.add(key);
        if (state === undefined) {
          state = {
            events: [],
            lastSeq: 0,
            snapshot: { threadId: args.threadId, events: [], lastSeq: 0 },
          };
          threads.set(args.threadId, state);
        }
        state.events.push(row.event);
        state.lastSeq = Math.max(state.lastSeq, row.seq);
        changed = true;
      }
      // The cursor moves WITH the append — in JS one synchronous call is the
      // whole transaction, so there is no window a crash could split.
      cursor = args.cursor;
      if (changed && state !== undefined) {
        rebuildThreadSnapshot(state, args.threadId);
        notifyThreads();
      }
    },

    snapshotThreads(): readonly StoredThread[] {
      if (threadsSnapshot === null) {
        threadsSnapshot = [...threads.values()]
          .map((state) => state.snapshot)
          .toSorted((a, b) => b.lastSeq - a.lastSeq);
      }
      return threadsSnapshot;
    },

    snapshotThread(threadId: string): StoredThread | null {
      return threads.get(threadId)?.snapshot ?? null;
    },

    subscribeThreads(onChange: () => void): () => void {
      threadListeners.add(onChange);
      return () => {
        threadListeners.delete(onChange);
      };
    },

    reset(): void {
      cursor = 0;
      threads.clear();
      appliedOrigins.clear();
      notifyThreads();
    },
  };
}
