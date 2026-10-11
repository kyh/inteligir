import type { DbConnection } from "@repo/db/connection";
import { turnStartOriginDeviceId } from "@repo/db/events";
import { bindPathOnlyOrigins, listPathOnlyOriginPaths } from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { mapWithConcurrency } from "../concurrency";
import { messageOf } from "../error-message";
import { BACKGROUND_READ_SLOTS } from "../vault/read-slots";
import type { ThreadOrigins } from "./thread-origins";

const RESTART_MESSAGE = "The server restarted while this turn was running";

// a crash between run.preparing and run.started leaves no turn to complete, so its failure names
// none. a recovered turn gets turn/completed too: provider/error alone projects no lifecycle, and
// the turn row would render "working" forever.
type WedgedRecovery =
  | { kind: "turnless"; message: string }
  | { kind: "turn"; events: ThreadEvent[] };

// only the process that owns a provider may declare it dead: a synced thread
// can be active because another device's turn is running, so the turn/started
// row is asked who wrote it.
export const wedgedRecovery = (db: DbConnection, thread: ThreadRow): WedgedRecovery | null => {
  const { activeTurnId } = thread;
  if (activeTurnId === null) {
    return { kind: "turnless", message: RESTART_MESSAGE };
  }
  if (turnStartOriginDeviceId(db, { threadId: thread.id, turnId: activeTurnId }) !== null) {
    return null;
  }
  return {
    events: [
      {
        message: RESTART_MESSAGE,
        scope: threadScope(),
        threadId: thread.id,
        type: "provider/error",
      },
      {
        scope: turnScope(activeTurnId),
        status: "failed",
        threadId: thread.id,
        type: "turn/completed",
      },
    ],
    kind: "turn",
  };
};

// a phone's request over a note with no id starts its thread on the path alone, because the
// dispatch reads the id and never mints one; so does a create over a note that could not take one.
// a thread bound by its path loses its note to a rename, so each such path takes the id its note
// carries, minted through the create's own guarded step; a note that is gone or cannot take one
// leaves its threads on the path. a bound row is never listed again, so a rerun reads only the
// paths still without one.
export const repairPathOnlyOrigins = async (
  db: DbConnection,
  origins: ThreadOrigins,
): Promise<void> => {
  await mapWithConcurrency(listPathOnlyOriginPaths(db), BACKGROUND_READ_SLOTS, async (path) => {
    let noteId: string | null;
    try {
      noteId = await origins.noteIdAt(path, "background");
    } catch (error) {
      // one note's fault costs its threads the id until the next boot, never the sweep.
      console.warn(`thread origins: ${path} stays bound by path: ${messageOf(error)}`);
      return;
    }
    if (noteId !== null) {
      bindPathOnlyOrigins(db, { noteId, path });
    }
  });
};
