// rests on events being append-only per thread while the server serves (nothing
// deletes a thread, and the one event removal, of this install's own synced
// copies, ends in boot before any read): the parsed log only grows, so a
// refresh reads afterSequence, and the projection served last is the base the
// next frame diffs against.

import type { DbConnection } from "@repo/db/connection";
import { listStoredThreadEvents } from "@repo/db/events";
import type { StoredThreadEvent } from "@repo/db/events";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import { buildThreadTimeline } from "@repo/api/local/build-thread-timeline";
import { setMostRecent } from "../evict-oldest";

const RESIDENT_THREADS = 8;
// the one just served, plus the bases a client a frame or two behind asks for.
const RESIDENT_PROJECTIONS = 4;

interface ThreadLog {
  events: StoredThreadEvent[];
  // the last row read, whether or not this build could parse it: a row it cannot is reported
  // once, not re-read by every refresh.
  readThrough: number;
  // keyed by the projection's own maxSequence.
  projections: Map<number, ThreadTimeline>;
}

const projection = (
  log: ThreadLog,
  maxSequence: number,
  events: readonly StoredThreadEvent[],
): ThreadTimeline => {
  const held = log.projections.get(maxSequence);
  if (held !== undefined) {
    setMostRecent(log.projections, maxSequence, held, RESIDENT_PROJECTIONS);
    return held;
  }
  const built = buildThreadTimeline(events);
  setMostRecent(log.projections, maxSequence, built, RESIDENT_PROJECTIONS);
  return built;
};

export class ThreadTimelineProjector {
  private readonly db: DbConnection;
  private readonly logs = new Map<string, ThreadLog>();

  constructor(db: DbConnection) {
    this.db = db;
  }

  full(threadId: string): ThreadTimeline {
    const log = this.refresh(threadId);
    return projection(log, log.events.at(-1)?.sequence ?? 0, log.events);
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
    return projection(
      log,
      upToSequence,
      log.events.filter((entry) => entry.sequence <= upToSequence),
    );
  }

  private refresh(threadId: string): ThreadLog {
    const existing = this.logs.get(threadId);
    if (existing === undefined) {
      const log: ThreadLog = { events: [], projections: new Map(), readThrough: 0 };
      this.readInto(threadId, log);
      setMostRecent(this.logs, threadId, log, RESIDENT_THREADS);
      return log;
    }
    setMostRecent(this.logs, threadId, existing, RESIDENT_THREADS);
    this.readInto(threadId, existing);
    return existing;
  }

  private readInto(threadId: string, log: ThreadLog): void {
    const read = listStoredThreadEvents(this.db, {
      afterSequence: log.readThrough,
      onSkipped: (row) => {
        log.readThrough = Math.max(log.readThrough, row.sequence);
        console.warn(
          `thread ${threadId}: event ${row.sequence} (${row.type}) is not one this build can read; its timeline leaves it out`,
        );
      },
      threadId,
    });
    log.events.push(...read);
    log.readThrough = Math.max(log.readThrough, read.at(-1)?.sequence ?? 0);
  }
}
