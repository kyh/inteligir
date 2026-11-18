// What moved in an account's library after a head a device holds, which every device asks on a beat
// in place of a socket (`@repo/client/library-changes`): every write stamps each item and folder row
// it touches with the sequence it takes, a purge keeps the purged id at its own, and a thread's move
// takes one too (`../agent/agent-threads`), so the rows past the head are what moved. Most asks find
// the head where the device left it, one statement.

import type { libraryMovedSchema } from "@repo/contract/library/library-wire";
import { agentThread } from "@repo/db/agent-schema";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { folder, item, purgedItem } from "@repo/db/library-schema";
import { and, asc, eq, gt } from "drizzle-orm";
import type { z } from "zod";

import { libraryHead } from "./library-rows";

type LibraryMoved = z.infer<typeof libraryMovedSchema>;

// the ids one answer names before it says "all"
const MOVED_IDS_MAX = 200;

const EVERYTHING: LibraryMoved = { folders: true, items: "all", threads: "all" };

// The head is read before the rows and outside any snapshot: a write lands its head and its rows
// in one commit, so every row at or under the head read is there, and one a later write stamped is
// named again by the next ask, which reads it again for nothing.
export const libraryChanges = async (db: DbExecutor, accountId: string, after?: number) => {
  const head = await libraryHead(db, accountId);
  if (after === undefined || after === head) {
    return { head, moved: null };
  }
  // a head the library never reached is a library emptied under the device
  if (after > head) {
    return { head, moved: EVERYTHING };
  }
  const [items, purged, folders, threads] = await Promise.all([
    db
      .select({ id: item.id, seq: item.seq })
      .from(item)
      .where(and(eq(item.accountId, accountId), gt(item.seq, after)))
      .orderBy(asc(item.seq))
      .limit(MOVED_IDS_MAX + 1),
    db
      .select({ id: purgedItem.id, seq: purgedItem.seq })
      .from(purgedItem)
      .where(and(eq(purgedItem.accountId, accountId), gt(purgedItem.seq, after)))
      .orderBy(asc(purgedItem.seq))
      .limit(MOVED_IDS_MAX + 1),
    db
      .select({ id: folder.id })
      .from(folder)
      .where(and(eq(folder.accountId, accountId), gt(folder.seq, after)))
      .limit(1),
    db
      .select({ id: agentThread.id })
      .from(agentThread)
      .where(and(eq(agentThread.accountId, accountId), gt(agentThread.seq, after)))
      .orderBy(asc(agentThread.seq))
      .limit(MOVED_IDS_MAX + 1),
  ]);
  const stamped = [...items, ...purged];
  const foldersMoved = folders.length > 0;
  if (stamped.length === 0 && !foldersMoved && threads.length === 0) {
    return { head, moved: null };
  }
  const moved: LibraryMoved = {
    folders: foldersMoved,
    items: stamped.length > MOVED_IDS_MAX ? "all" : stamped,
    threads: threads.length > MOVED_IDS_MAX ? "all" : threads.map(({ id }) => id),
  };
  return { head, moved };
};
