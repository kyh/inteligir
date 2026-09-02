// deltas park until the next macrotask so a streaming burst lands as one ingest transaction and one ws frame;
// a non-delta event flushes its thread immediately, buffered deltas first, so boundaries never reorder around deltas.

import type { ThreadEvent } from "@repo/domain/provider-event";

const DELTA_EVENT_TYPES: ReadonlySet<ThreadEvent["type"]> = new Set([
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
]);

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
    if (DELTA_EVENT_TYPES.has(event.type)) {
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
    this.ingest(threadId, pending);
  }

  flushAll(): void {
    // snapshot first: flush() deletes the entry it drains.
    const threadIds = Array.from(this.pendingByThreadId.keys());
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
