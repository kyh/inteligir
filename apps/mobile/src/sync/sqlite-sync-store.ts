// the synced threads in the phone's database, read back into memory on a restore: the screens read
// the memory, and a pulled page lands on disk first, in one transaction with the cursor past it, and
// in memory only once that commits. every write re-checks a reset generation, so a page started
// before a sign-out or a revocation never lands.

import { z } from "zod";
import { hexFromBytes } from "@repo/api/cloud/bytes";
import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import { isThreadEventDelta, threadEventSchema } from "@repo/domain/provider-event";
import { migratePhoneDb } from "../lib/phone-db";
import { createSerialLock } from "../lib/sql-driver";
import type { SqlDriver, SqlExecutor } from "../lib/sql-driver";
import type { Sha1 } from "../notes/outbox-ops";
import type { StoredThread, StoredThreadEvent, SyncStore } from "./sync-store";

export interface CreateSqliteSyncStoreArgs {
  db: SqlDriver;
  sha1: Sha1;
}

interface Held {
  cursor: number;
  threads: ReadonlyMap<string, StoredThread>;
}

// what a page's transaction writes: the held events it adds, the threads it moves, and the cursor
interface PageWrite {
  cursor: number;
  events: { seq: number; threadId: string; event: StoredThreadEvent }[];
  threads: Map<string, StoredThread>;
}

const EMPTY: Held = { cursor: 0, threads: new Map() };

const syncRowSchema = z.object({ cursor: z.number().int().min(0), grammar: z.string() });
const threadRowSchema = z.object({ last_seq: z.number().int(), thread_id: z.string() });
const eventRowSchema = z.object({ event: z.string(), thread_id: z.string() });

// the digest of the grammar the held events were parsed with. a build whose grammar differs pulls
// the log again from its first row: it may read rows the last one skipped, and each held event
// lacks whatever the last grammar did not name, since its objects strip unknown fields.
const grammarDigest = async (sha1: Sha1): Promise<string> =>
  hexFromBytes(
    await sha1(new TextEncoder().encode(JSON.stringify(z.toJSONSchema(threadEventSchema)))),
  );

const planWrite = (held: Held, steps: readonly LogPlanStep[]): PageWrite => {
  const write: PageWrite = { cursor: held.cursor, events: [], threads: new Map() };
  for (const step of steps) {
    if (step.kind === "skip") {
      write.cursor = Math.max(write.cursor, step.cursor);
      continue;
    }
    const current = write.threads.get(step.threadId) ?? held.threads.get(step.threadId);
    const appended: StoredThreadEvent[] = [];
    let lastSeq = current?.lastSeq ?? 0;
    let changed = false;
    for (const row of step.rows) {
      // the log and its cursor move together, so a row at or below the cursor was applied or
      // skipped already
      if (row.seq <= write.cursor) {
        continue;
      }
      changed = true;
      write.cursor = row.seq;
      lastSeq = Math.max(lastSeq, row.seq);
      if (!isThreadEventDelta(row.event)) {
        appended.push(row.event);
        write.events.push({ event: row.event, seq: row.seq, threadId: step.threadId });
      }
    }
    if (!changed) {
      continue;
    }
    // a snapshot is never mutated, so a step that appends copies once; a step of deltas alone
    // keeps the array and only moves the thread's recency
    const kept = current?.events ?? [];
    write.threads.set(step.threadId, {
      events: appended.length === 0 ? kept : [...kept, ...appended],
      lastSeq,
      threadId: step.threadId,
    });
  }
  return write;
};

// the memory is what a page is planned over and the disk follows it, so a row a failed read or
// wipe left behind is replaced rather than refusing the page
const writePage = async (tx: SqlExecutor, write: PageWrite, grammar: string): Promise<void> => {
  for (const row of write.events) {
    await tx.run("INSERT OR REPLACE INTO thread_events (seq, thread_id, event) VALUES (?, ?, ?)", [
      row.seq,
      row.threadId,
      JSON.stringify(row.event),
    ]);
  }
  for (const thread of write.threads.values()) {
    await tx.run("INSERT OR REPLACE INTO synced_threads (thread_id, last_seq) VALUES (?, ?)", [
      thread.threadId,
      thread.lastSeq,
    ]);
  }
  await tx.run("INSERT OR REPLACE INTO thread_sync (id, cursor, grammar) VALUES (1, ?, ?)", [
    write.cursor,
    grammar,
  ]);
};

// null when another grammar parsed what is held; a row this build cannot read throws
const readHeld = async (db: SqlDriver, grammar: string): Promise<Held | null> => {
  const [syncRow] = await db.all("SELECT cursor, grammar FROM thread_sync");
  if (syncRow === undefined) {
    return EMPTY;
  }
  const sync = syncRowSchema.parse(syncRow);
  if (sync.grammar !== grammar) {
    return null;
  }
  const threads = new Map<string, StoredThread>();
  const events = new Map<string, StoredThreadEvent[]>();
  for (const raw of await db.all("SELECT thread_id, last_seq FROM synced_threads")) {
    const row = threadRowSchema.parse(raw);
    const held: StoredThreadEvent[] = [];
    events.set(row.thread_id, held);
    threads.set(row.thread_id, { events: held, lastSeq: row.last_seq, threadId: row.thread_id });
  }
  for (const raw of await db.all("SELECT thread_id, event FROM thread_events ORDER BY seq")) {
    const row = eventRowSchema.parse(raw);
    const event = threadEventSchema.parse(JSON.parse(row.event));
    const held = events.get(row.thread_id);
    if (held === undefined || isThreadEventDelta(event)) {
      throw new Error(`a held event of ${row.thread_id} is not one this store writes`);
    }
    held.push(event);
  }
  return { cursor: sync.cursor, threads };
};

export const createSqliteSyncStore = (args: CreateSqliteSyncStoreArgs): SyncStore => {
  const { db } = args;
  // on the first call, so a failed migration fails the call that asked rather than nobody
  let migrated: Promise<void> | null = null;
  const ready = async (): Promise<void> => {
    migrated ??= migratePhoneDb(db);
    await migrated;
  };
  let digest: Promise<string> | null = null;
  const grammar = async (): Promise<string> => {
    digest ??= grammarDigest(args.sha1);
    return await digest;
  };
  // a reset's disk work and every page run one at a time, in call order
  const serial = createSerialLock();
  let generation = 0;
  let held = EMPTY;

  const listeners = new Set<() => void>();
  let snapshot: readonly StoredThread[] | null = null;
  // snapshots are cached and rebuilt only on change: useSyncExternalStore treats a fresh reference
  // as new state
  const adopt = (next: Held): void => {
    held = next;
    snapshot = null;
    for (const listener of listeners) {
      listener();
    }
  };

  const wipe = async (): Promise<void> => {
    await ready();
    await db.exclusive(async (tx) => {
      await tx.exec(
        "DELETE FROM thread_events; DELETE FROM synced_threads; DELETE FROM thread_sync;",
      );
    });
  };

  // false when what the disk holds must go: another grammar parsed it, or it cannot be read
  const restore = async (started: number): Promise<boolean> => {
    try {
      await ready();
      const read = await readHeld(db, await grammar());
      if (read !== null && generation === started) {
        adopt(read);
      }
      return read !== null;
    } catch {
      return false;
    }
  };

  return {
    applyPlan: async (steps) => {
      if (steps.length === 0) {
        return;
      }
      const started = generation;
      await serial(async () => {
        await ready();
        const written = await grammar();
        if (generation !== started) {
          return;
        }
        const write = planWrite(held, steps);
        const outcome = { landed: false };
        await db.exclusive(async (tx) => {
          if (generation !== started) {
            return;
          }
          await writePage(tx, write, written);
          outcome.landed = true;
        });
        if (!outcome.landed || generation !== started) {
          return;
        }
        if (write.threads.size === 0) {
          held = { cursor: write.cursor, threads: held.threads };
          return;
        }
        adopt({ cursor: write.cursor, threads: new Map([...held.threads, ...write.threads]) });
      });
    },

    readCursor: () => held.cursor,

    reset: async (next) => {
      generation += 1;
      const started = generation;
      adopt(EMPTY);
      await serial(async () => {
        if (next === "restored" && (await restore(started))) {
          return;
        }
        try {
          await wipe();
        } catch {
          // memory starts over from the log's first row whatever the disk holds, and each page
          // replaces the row at its seq; the next sign-in wipes again
        }
      });
    },

    snapshotThread: (threadId) => held.threads.get(threadId) ?? null,

    snapshotThreads: () => {
      snapshot ??= [...held.threads.values()].toSorted((a, b) => b.lastSeq - a.lastSeq);
      return snapshot;
    },

    subscribeThreads: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
};
