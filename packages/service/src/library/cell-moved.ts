// What a write moved, gathered as it lands and told every socket of the account in the turn it
// commits (`./library-engine`): each item at the sequence it now holds, whether a folder moved, and
// which threads. A list past `MOVED_IDS_MAX` says "all", so a frame stays small whatever an undo
// or a purge moved. An item it moved into or out of Deleted is named apart, for its note to hear.

import { MOVED_IDS_MAX } from "@repo/contract/library/library-socket";
import type { MovedFrame } from "@repo/contract/library/library-socket";

export interface MovedCollector {
  readonly item: (id: string, seq: number) => void;
  readonly folder: () => void;
  readonly thread: (id: string) => void;
  // an item whose note writes its body went into Deleted or came back
  readonly reopen: (itemId: string) => void;
}

export const collectMoved = (): MovedCollector & {
  // a frame's moves beside these, for an alarm's run, which tells its writes' frames as one
  readonly add: (frame: MovedFrame) => void;
  // null when the write moved nothing a client reads
  readonly frame: () => MovedFrame | null;
  // the items whose notes open their sockets again, which no frame names
  readonly reopens: () => string[];
} => {
  const items = new Map<string, number>();
  const threads = new Set<string>();
  const reopens = new Set<string>();
  let folders = false;
  // a list some added frame already said "all" of
  const all = { items: false, threads: false };
  return {
    add: (frame) => {
      folders ||= frame.folders;
      all.items ||= frame.items === "all";
      all.threads ||= frame.threads === "all";
      for (const { id, seq } of frame.items === "all" ? [] : frame.items) {
        items.set(id, seq);
      }
      for (const id of frame.threads === "all" ? [] : frame.threads) {
        threads.add(id);
      }
    },
    folder: () => {
      folders = true;
    },
    frame: () =>
      items.size === 0 && threads.size === 0 && !folders && !all.items && !all.threads
        ? null
        : {
            folders,
            items:
              all.items || items.size > MOVED_IDS_MAX
                ? "all"
                : [...items].map(([id, seq]) => ({ id, seq })),
            threads: all.threads || threads.size > MOVED_IDS_MAX ? "all" : [...threads],
            type: "moved",
          },
    item: (id, seq) => {
      items.set(id, seq);
    },
    reopen: (itemId) => {
      reopens.add(itemId);
    },
    reopens: () => [...reopens],
    thread: (id) => {
      threads.add(id);
    },
  };
};
