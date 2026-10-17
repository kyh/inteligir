// the queue's order over a fake store and clock: which rows a free slot starts, and in what order,
// so a save made during an import is never filled behind it and one site's rows never hold every
// other site's back.

import { describe, expect, it } from "vitest";

import type { CaptureClock } from "../capture-ports";
import type { FillOutcome } from "../fill-item";
import { createFillQueue } from "../fill-queue";
import type { FillQueue } from "../fill-queue";
import type { PendingFillsStore } from "../pending-fills-store";

const memoryStore = (): PendingFillsStore => ({
  all: () => [],
  insert: () => {},
  remove: () => {},
  reschedule: () => {},
  setKeepCopy: () => {},
  setPath: () => {},
  shuffleSeed: () => "seed",
});

const stillClock = (): CaptureClock => ({
  now: () => 1_000_000,
  setTimer: () => () => {},
});

interface Held {
  url: string;
  release: () => void;
}

interface HeldQueue {
  queue: FillQueue;
  started: string[];
  held: Held[];
}

// a queue whose fills wait until the suite releases them, recording the order they started in
const heldQueue = (): HeldQueue => {
  const started: string[] = [];
  const held: Held[] = [];
  const queue = createFillQueue({
    clock: stillClock(),
    copyAfter: async () => await Promise.resolve({ kind: "aborted" }),
    core: {
      commitPaths: async () => {},
      creatorOf: async () => await Promise.resolve(null),
      read: async () => await Promise.resolve(null),
      syncNow: async () => {},
      syncsWithAccount: async () => await Promise.resolve(false),
    },
    debug: () => {},
    fillRow: async (target) => {
      started.push(target.url);
      const done = Promise.withResolvers<FillOutcome>();
      held.push({
        release: () => {
          done.resolve({
            fill: { state: "filled" },
            kind: "written",
            path: target.path,
            wrote: [],
          });
        },
        url: target.url,
      });
      return await done.promise;
    },
    knowledge: {
      itemStubs: async () => await Promise.resolve([]),
      pathForNoteId: async () => await Promise.resolve(null),
    },
    store: memoryStore(),
    takeSupplied: () => null,
  });
  return { held, queue, started };
};

const importRow = (index: number, host: string) => ({
  coverHint: null,
  itemId: `import-${String(index)}`,
  keepCopy: false,
  origin: "import" as const,
  path: `Imported/${String(index)}.md`,
  url: `https://${host}/watch?v=${String(index)}`,
});

const settleTurns = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
};

describe("the fill queue", () => {
  it("starts another site's row beside one site's import thousands deep", async () => {
    const { queue, started } = heldQueue();
    for (let index = 0; index < 1000; index += 1) {
      queue.add(importRow(index, index < 300 ? "youtube.com" : `site${String(index)}.test`));
    }
    await settleTurns();
    expect(started).toEqual(["https://youtube.com/watch?v=0", "https://site300.test/watch?v=300"]);
  });

  it("fills a save made during an import as soon as a slot is free", async () => {
    const { held, queue, started } = heldQueue();
    for (let index = 0; index < 1000; index += 1) {
      queue.add(importRow(index, index < 300 ? "youtube.com" : `site${String(index)}.test`));
    }
    queue.add({
      coverHint: null,
      itemId: "mine",
      keepCopy: false,
      origin: "own",
      path: "Unsorted/Mine.md",
      url: "https://example.org/a",
    });
    await settleTurns();
    held[0]?.release();
    await settleTurns();
    expect(started.slice(0, 3)).toEqual([
      "https://youtube.com/watch?v=0",
      "https://site300.test/watch?v=300",
      "https://example.org/a",
    ]);
  });
});
