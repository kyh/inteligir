// CLAUDE.md § THE GRID'S SELECTION IS A STORE. A selected path a change took away is looked for by
// its item's id, as the open item is: a move is followed, an id nothing answers is pruned, and one
// the index cannot place yet (a read of the new path still out) stays selected and is asked after
// again on the open item's schedule, then pruned at its end.

import { FOLLOW_ASK_AGAIN_MS } from "@repo/editor/note/vault-session";
import type { MovedItem } from "@repo/editor/note/vault-session";

import type { SelectionGesture } from "./library-selection";

// the index's answer for an id, as both followers read it: a null while a read is out is no
// answer yet, never a gone item
export const movedItemOf = (answer: {
  readonly path: string | null;
  readonly pending: boolean;
}): MovedItem => {
  if (answer.path !== null) {
    return { kind: "at", path: answer.path };
  }
  return answer.pending ? { kind: "unknown" } : { kind: "gone" };
};

interface SelectionFollowArgs {
  ask: (path: string, id: string) => Promise<MovedItem>;
  apply: (gesture: SelectionGesture) => void;
  schedule?: readonly number[];
}

interface SelectionFollow {
  // `ids` names each path's item, read before the change refetched the rows; a path with none
  // cannot be followed and is pruned
  follow: (vanished: readonly string[], ids: ReadonlyMap<string, string>) => void;
  dispose: () => void;
}

export const createSelectionFollow = ({
  ask,
  apply,
  schedule = FOLLOW_ASK_AGAIN_MS,
}: SelectionFollowArgs): SelectionFollow => {
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  // a path asked after already: a second change that names it again waits on the first
  const following = new Set<string>();

  const look = async (
    paths: readonly string[],
    ids: ReadonlyMap<string, string>,
    attempt: number,
  ): Promise<void> => {
    const moves = new Map<string, string>();
    const gone = new Set<string>();
    const unknown: string[] = [];
    for (const path of paths) {
      const id = ids.get(path);
      const answer: MovedItem =
        id === undefined
          ? { kind: "gone" }
          : await ask(path, id).catch((): MovedItem => ({ kind: "unknown" }));
      if (disposed) {
        return;
      }
      if (answer.kind === "unknown") {
        unknown.push(path);
        continue;
      }
      following.delete(path);
      // the old path again is the item back where it was: it stays selected
      if (answer.kind === "at" && answer.path !== path) {
        moves.set(path, answer.path);
      } else if (answer.kind === "gone") {
        gone.add(path);
      }
    }
    if (moves.size > 0) {
      apply({ kind: "moved", moves });
    }
    const wait = schedule[attempt];
    if (unknown.length > 0 && wait === undefined) {
      for (const path of unknown) {
        following.delete(path);
        gone.add(path);
      }
    }
    if (gone.size > 0) {
      apply({ gone, kind: "prune" });
    }
    if (unknown.length > 0 && wait !== undefined) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void look(unknown, ids, attempt + 1);
      }, wait);
      timers.add(timer);
    }
  };

  return {
    dispose() {
      disposed = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      following.clear();
    },

    follow(vanished, ids) {
      const fresh = vanished.filter((path) => !following.has(path));
      for (const path of fresh) {
        following.add(path);
      }
      if (fresh.length > 0) {
        void look(fresh, ids, 0);
      }
    },
  };
};
