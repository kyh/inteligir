// deltas park until the next macrotask so a streaming burst lands as one ingest transaction and one ws frame,
// and each item's run of deltas as one row; a non-delta event flushes its thread immediately, buffered deltas
// first, so boundaries never reorder around deltas. a merged row stays inside the sync row cap, so a merge
// never turns deltas that would each have synced whole into one the outbox has to clip.

import { utf8ByteLength } from "@repo/api/cloud/bytes";
import { EVENT_MAX_BYTES } from "@repo/api/cloud/sync/sync-schema";
import { isThreadEventDelta, mergeAdjacentDeltas } from "@repo/domain/provider-event";
import type { DeltaRunLimit, ThreadEvent } from "@repo/domain/provider-event";

const SYNC_ROW_LIMIT: DeltaRunLimit = {
  jsonBytes: (value) => utf8ByteLength(JSON.stringify(value)),
  maxBytes: EVENT_MAX_BYTES,
};

export class ProviderEventCoalescer {
  private readonly ingest: (threadId: string, events: readonly ThreadEvent[]) => void;
  private readonly pendingByThreadId = new Map<string, ThreadEvent[]>();
  private flushScheduled = false;

  constructor(ingest: (threadId: string, events: readonly ThreadEvent[]) => void) {
    this.ingest = ingest;
  }

  push(threadId: string, event: ThreadEvent): void {
    const pending = this.pendingByThreadId.get(threadId);
    if (pending === undefined) {
      this.pendingByThreadId.set(threadId, [event]);
    } else {
      pending.push(event);
    }
    if (isThreadEventDelta(event)) {
      this.scheduleFlush();
    } else {
      this.flush(threadId);
    }
  }

  flush(threadId: string): void {
    const pending = this.pendingByThreadId.get(threadId);
    if (pending === undefined) {
      return;
    }
    this.pendingByThreadId.delete(threadId);
    this.ingest(threadId, mergeAdjacentDeltas(pending, SYNC_ROW_LIMIT));
  }

  flushAll(): void {
    // snapshot first: flush() deletes the entry it drains.
    const threadIds = [...this.pendingByThreadId.keys()];
    for (const threadId of threadIds) {
      this.flush(threadId);
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    // setImmediate over a microtask: an adapter draining one stdio chunk awaits between lines, so a microtask would still flush per delta.
    setImmediate(() => {
      this.flushScheduled = false;
      this.flushAll();
    });
  }
}
