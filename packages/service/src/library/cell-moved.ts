// What one landed write moved, gathered as it lands and told every socket of the account once it
// commits (`./cell-library`'s `settleCommit`): each item at the sequence it now holds, whether a
// folder moved, and which threads. A list past `MOVED_IDS_MAX` says "all", so a frame stays small
// whatever an undo or a purge moved.

import { MOVED_IDS_MAX } from "@repo/contract/library/library-socket";
import type { MovedFrame } from "@repo/contract/library/library-socket";

export interface MovedCollector {
  readonly item: (id: string, seq: number) => void;
  readonly folder: () => void;
  readonly thread: (id: string) => void;
}

// what the alarm's jobs moved, which no one write names: an import's pages above all
export const EVERYTHING_MOVED: MovedFrame = {
  folders: true,
  items: "all",
  threads: "all",
  type: "moved",
};

export const collectMoved = (): MovedCollector & {
  // null when the write moved nothing a client reads
  readonly frame: () => MovedFrame | null;
} => {
  const items = new Map<string, number>();
  const threads = new Set<string>();
  let folders = false;
  return {
    folder: () => {
      folders = true;
    },
    frame: () =>
      items.size === 0 && threads.size === 0 && !folders
        ? null
        : {
            folders,
            items:
              items.size > MOVED_IDS_MAX ? "all" : [...items].map(([id, seq]) => ({ id, seq })),
            threads: threads.size > MOVED_IDS_MAX ? "all" : [...threads],
            type: "moved",
          },
    item: (id, seq) => {
      items.set(id, seq);
    },
    thread: (id) => {
      threads.add(id);
    },
  };
};
