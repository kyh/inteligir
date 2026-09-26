// A changes-committed frame names its thread, never its turn, and an undo sends the same frame a
// finished turn does. So a thread's turns are read on its first frame since the window opened, and
// a later commit frame announces the newest applied turn that read did not hold. A thread first
// heard through a commit frame alone ran nothing in between, so that frame is an undo's.

import type { ThreadChangedMessage } from "@repo/api/local/notifications";
import type { TurnChanges } from "@repo/api/local/threads/threads-schema";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useEffect, useEffectEvent } from "react";
import { client } from "../api";
import { useWorkspace } from "../workspace-context";
import { reportUndo, turnNotePaths, undoTurnChanges } from "./undo-turn";
import type { UndoTurnApi } from "./undo-turn";

export interface FinishedTurn {
  threadId: string;
  turnId: string;
  notePaths: readonly string[];
}

interface TurnFinishPorts {
  // oldest first, as the server answers
  readTurns: (threadId: string) => Promise<readonly TurnChanges[]>;
  announce: (finished: FinishedTurn) => void;
}

type ThreadWatch = { kind: "reading" } | { kind: "read"; turnIds: ReadonlySet<string> };

const READING: ThreadWatch = { kind: "reading" };

// judged as the frame arrives, since its read waits behind the thread's earlier ones
type Announces =
  // the thread's newest turn: the commit raced the thread's first read, which may already hold it,
  // or arrived in one flush with the activity that made it
  | "newest"
  // the newest turn the thread's last read did not hold
  | "unread"
  | "nothing";

const announcesOf = (message: ThreadChangedMessage, watch: ThreadWatch | undefined): Announces => {
  if (watch?.kind === "read") {
    return "unread";
  }
  if (watch?.kind === "reading") {
    return "newest";
  }
  return message.changes.some((kind) => kind !== "changes-committed") ? "newest" : "nothing";
};

// `known` is the thread's watch once every earlier read of it landed
const finishedTurnOf = (
  turns: readonly TurnChanges[],
  announces: Announces,
  known: ThreadWatch | undefined,
): TurnChanges | undefined => {
  switch (announces) {
    case "newest": {
      const newest = turns.at(-1);
      return newest?.state === "applied" ? newest : undefined;
    }
    case "unread": {
      if (known?.kind !== "read") {
        return undefined;
      }
      return turns.findLast((turn) => turn.state === "applied" && !known.turnIds.has(turn.turnId));
    }
    case "nothing": {
      return undefined;
    }
    default: {
      const exhaustive: never = announces;
      return exhaustive;
    }
  }
};

interface TurnFinishWatch {
  observe: (message: ThreadChangedMessage) => void;
  dispose: () => void;
}

export const createTurnFinishWatch = (ports: TurnFinishPorts): TurnFinishWatch => {
  const watches = new Map<string, ThreadWatch>();
  const queues = new Map<string, Promise<void>>();
  const announced = new Set<string>();
  let disposed = false;

  // one thread's reads land in the order its frames came, so a later read never stands in for an
  // earlier one.
  const enqueue = (threadId: string, task: () => Promise<void>): void => {
    const previous = queues.get(threadId);
    const next = (async () => {
      await previous;
      try {
        await task();
      } catch {
        // a first read that failed leaves the thread unread, so its next frame reads again
        if (watches.get(threadId) === READING) {
          watches.delete(threadId);
        }
      }
    })();
    queues.set(threadId, next);
  };

  const settle = async (threadId: string, announces: Announces | null): Promise<void> => {
    const turns = await ports.readTurns(threadId);
    const known = watches.get(threadId);
    watches.set(threadId, { kind: "read", turnIds: new Set(turns.map((turn) => turn.turnId)) });
    if (announces === null || disposed) {
      return;
    }
    const turn = finishedTurnOf(turns, announces, known);
    if (turn === undefined || announced.has(turn.turnId)) {
      return;
    }
    announced.add(turn.turnId);
    const notePaths = turnNotePaths(turn);
    if (notePaths.length > 0) {
      ports.announce({ notePaths, threadId, turnId: turn.turnId });
    }
  };

  return {
    dispose: () => {
      disposed = true;
    },
    observe: (message) => {
      // a reconnect sweep names no thread: it says a gap may hide changes, not that a turn finished
      if (message.id === undefined) {
        return;
      }
      const threadId = message.id;
      const watch = watches.get(threadId);
      if (message.changes.includes("changes-committed")) {
        const announces = announcesOf(message, watch);
        enqueue(threadId, async () => {
          await settle(threadId, announces);
        });
        return;
      }
      // the thread's first activity since the window opened: its turns as they stand, before
      // whatever this activity goes on to commit
      if (watch === undefined) {
        watches.set(threadId, READING);
        enqueue(threadId, async () => {
          await settle(threadId, null);
        });
      }
    },
  };
};

export const turnFinishMessage = (noteCount: number): string =>
  `Agent edited ${plural(noteCount, "note")}`;

const showTurnFinishToast = (
  finished: FinishedTurn,
  api: UndoTurnApi,
  showHistory: (path: string) => void,
): void => {
  toast(turnFinishMessage(finished.notePaths.length), {
    action: {
      label: "Undo",
      onClick: () => {
        void (async () => {
          const outcome = await undoTurnChanges(api, {
            threadId: finished.threadId,
            turnId: finished.turnId,
          });
          reportUndo(outcome, showHistory);
        })();
      },
    },
  });
};

export const useTurnFinishToast = (showHistory: (path: string) => void): void => {
  const { threadEvents } = useWorkspace();
  const openHistory = useEffectEvent(showHistory);
  useEffect(() => {
    const watch = createTurnFinishWatch({
      announce: (finished) => {
        showTurnFinishToast(finished, client, openHistory);
      },
      readTurns: async (threadId) => {
        const { turns } = await client.threads.turnChanges({ threadId });
        return turns;
      },
    });
    const unsubscribe = threadEvents.subscribe(watch.observe);
    return () => {
      unsubscribe();
      watch.dispose();
    };
  }, [threadEvents]);
};
