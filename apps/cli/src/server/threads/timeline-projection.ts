// rests on events being append-only per thread (nothing deletes an event row
// or a thread): the parsed log only grows, so a refresh reads afterSequence,
// and the projection served last is the base the next frame diffs against.

import type { DbConnection } from "@repo/db/connection";
import { listStoredThreadEvents, type StoredThreadEvent } from "@repo/db/events";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import { buildThreadTimeline } from "@repo/api/local/build-thread-timeline";

const RESIDENT_THREADS = 8;
// the one just served, plus the bases a client a frame or two behind asks for.
const RESIDENT_PROJECTIONS = 4;

interface ThreadLog {
  events: StoredThreadEvent[];
  // keyed by the projection's own maxSequence.
  projections: Map<number, ThreadTimeline>;
}

// Map iterates in insertion order and every read re-inserts, so this is an LRU.
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

  full(threadId: string): ThreadTimeline {
    const log = this.refresh(threadId);
    return this.projection(log, log.events.at(-1)?.sequence ?? 0, log.events);
  }

  // must follow full() for the same thread, whose refresh it reads the log from.
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
      // re-insert so the LRU counts this read.
      log.projections.delete(maxSequence);
      log.projections.set(maxSequence, held);
      return held;
    }
    const built = buildThreadTimeline(events);
    log.projections.set(maxSequence, built);
    evict(log.projections, RESIDENT_PROJECTIONS);
    return built;
  }

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
