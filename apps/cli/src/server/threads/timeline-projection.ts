// The memo behind `ThreadService.timeline`.
//
// Every provider event notifies the thread, and every subscriber answers that
// by asking for the timeline again — so a turn asks n times while its own log
// grows to n. Reading the whole log back each time (a JSON.parse and a zod
// parse per row) made that O(n²), and the delta branch then projected the log a
// SECOND time to reconstruct the base it diffs against.
//
// Two memos, both resting on one fact: `events` is APPEND-ONLY per thread —
// nothing in this repo deletes an event row, and no path deletes a thread — so
// the parsed log can only grow and a refresh reads `afterSequence` instead of
// everything. And a projection is a pure function of a prefix, so the
// projection this frame serves IS the base the next frame diffs against;
// keeping the last few by their own maxSequence covers the streaming case, and
// anything else falls back to projecting the prefix, which is what the code
// did unconditionally before.
//
// Bounded on both axes, because a vault can hold hundreds of threads and this
// process outlives every one of them: the parsed log is kept for the most
// recently read threads only, and a thread keeps only its most recent
// projections.

import type { DbConnection } from "@repo/db/connection";
import { listStoredThreadEvents, type StoredThreadEvent } from "@repo/db/events";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import { buildThreadTimeline } from "@repo/thread-view/build-thread-timeline";

/** Threads whose parsed log is kept resident. */
const RESIDENT_THREADS = 8;
/** Projections kept per thread: the one just served, plus the bases a second
 *  client one or two frames behind will ask for. */
const RESIDENT_PROJECTIONS = 4;

interface ThreadLog {
  events: StoredThreadEvent[];
  /** Keyed by the projection's own `maxSequence`. */
  projections: Map<number, ThreadTimeline>;
}

/** Drop the oldest entries until `map` holds at most `limit` — Map iterates in
 *  insertion order, and every read re-inserts, so this is an LRU. */
function evict(map: Map<unknown, unknown>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done === true) {
      return;
    }
    map.delete(oldest.value);
  }
}

export class ThreadTimelineProjector {
  private readonly db: DbConnection;
  private readonly logs = new Map<string, ThreadLog>();

  constructor(db: DbConnection) {
    this.db = db;
  }

  /** The timeline of this thread's whole log, as of now. */
  full(threadId: string): ThreadTimeline {
    const log = this.refresh(threadId);
    return this.projection(log, log.events.at(-1)?.sequence ?? 0, log.events);
  }

  /**
   * The timeline the prefix ending at `upToSequence` projects to — the base a
   * delta is diffed against. Must be called after {@link full} for the same
   * thread, whose refresh it reads the log from.
   */
  prefix(threadId: string, upToSequence: number): ThreadTimeline {
    const log = this.logs.get(threadId);
    if (log === undefined) {
      throw new Error(`No timeline log for thread ${threadId}`);
    }
    const held = log.projections.get(upToSequence);
    if (held !== undefined) {
      return held;
    }
    return this.projection(
      log,
      upToSequence,
      log.events.filter((entry) => entry.sequence <= upToSequence),
    );
  }

  private projection(
    log: ThreadLog,
    maxSequence: number,
    events: readonly StoredThreadEvent[],
  ): ThreadTimeline {
    const held = log.projections.get(maxSequence);
    if (held !== undefined) {
      // Re-insert so the LRU counts this read.
      log.projections.delete(maxSequence);
      log.projections.set(maxSequence, held);
      return held;
    }
    const built = buildThreadTimeline(events);
    log.projections.set(maxSequence, built);
    evict(log.projections, RESIDENT_PROJECTIONS);
    return built;
  }

  /** The thread's parsed log, extended with whatever landed since. */
  private refresh(threadId: string): ThreadLog {
    const existing = this.logs.get(threadId);
    if (existing === undefined) {
      const log: ThreadLog = {
        events: listStoredThreadEvents(this.db, { threadId }),
        projections: new Map(),
      };
      this.logs.set(threadId, log);
      evict(this.logs, RESIDENT_THREADS);
      return log;
    }
    this.logs.delete(threadId);
    this.logs.set(threadId, existing);
    const afterSequence = existing.events.at(-1)?.sequence;
    if (afterSequence !== undefined) {
      existing.events.push(...listStoredThreadEvents(this.db, { threadId, afterSequence }));
    } else {
      existing.events.push(...listStoredThreadEvents(this.db, { threadId }));
    }
    return existing;
  }
}
