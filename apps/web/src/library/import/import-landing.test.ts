import { blankItemFields, importedFields } from "@repo/contract/library/item-makes";
import { paragraph } from "@repo/contract/test-support/library-items";
import { describe, expect, it } from "vitest";

import { createBatcher, freshTally } from "./import-landing";
import type { ImportCell, ImportedItem } from "./import-landing";

// a cell that keeps each batch it was sent, and counts each item added
const keepingCell = () => {
  const batches: ImportedItem[][] = [];
  const cell: ImportCell = {
    keep: async () => await Promise.resolve(null),
    land: async (items) => {
      batches.push([...items]);
      return await Promise.resolve({ added: items.length, alreadySaved: 0, unreadable: 0 });
    },
    named: async () => await Promise.resolve({ named: [], originals: [] }),
    settle: async () => await Promise.resolve([]),
  };
  return { batches, cell };
};

// a note of `blocks` paragraphs, each of `text`
const noteOf = (id: string, blocks: number, text: string): ImportedItem => ({
  blocks: Array.from({ length: blocks }, (_, at) => ({
    block: paragraph(`${id}-${String(at)}`, text),
    section: "note" as const,
  })),
  cover: null,
  fields: importedFields({ ...blankItemFields(1_700_000_000_000), title: id }),
  folder: null,
  id: `0190a000-0000-7000-8000-${id.padStart(12, "0")}`,
  kind: "new",
});

describe(createBatcher, () => {
  it("counts an item past what a body holds unreadable, and sends none of it", async () => {
    const { batches, cell } = keepingCell();
    const tally = freshTally();
    const batcher = createBatcher(cell, tally, () => {});
    // five blocks of 150,000 three-byte characters: past 1 MiB of UTF-8, under it in UTF-16
    await batcher.add(noteOf("1", 5, "語".repeat(150_000)));
    await batcher.add(noteOf("2", 1, "Short."));
    await batcher.flush();
    expect(tally).toMatchObject({ added: 1, unreadable: 1 });
    expect(batches.map((batch) => batch.map((item) => item.id))).toStrictEqual([
      ["0190a000-0000-7000-8000-000000000002"],
    ]);
  });

  it("sends a batch before its UTF-8 bytes pass 4 MiB", async () => {
    const { batches, cell } = keepingCell();
    const batcher = createBatcher(cell, freshTally(), () => {});
    // each about 0.96 MB of UTF-8 and 0.32 MB of UTF-16: four to a batch, not thirteen
    for (let at = 1; at <= 5; at += 1) {
      await batcher.add(noteOf(String(at), 2, "語".repeat(160_000)));
    }
    await batcher.flush();
    expect(batches.map((batch) => batch.length)).toStrictEqual([4, 1]);
  });
});
