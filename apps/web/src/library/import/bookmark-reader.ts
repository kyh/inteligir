import { webNoteBlocks } from "@repo/editor/headless/codec/item-markdown";

import { newId } from "../cloud/new-id";
import { bookmarkFields, highlightBlocks, planBookmarks } from "./bookmark-plan";
import type { BookmarkParse } from "./bookmark-plan";
import { createBatcher, importFolder, ImportStoppedError } from "./import-landing";
import type { ImportReader } from "./import-landing";

interface BookmarkFormat<Reason extends string> {
  readonly parse: (text: string) => BookmarkParse<Reason>;
  readonly unreadable: Readonly<Record<Reason | "empty", string>>;
}

const newBlockId = () => crypto.randomUUID();

export const bookmarkReader = <Reason extends string>({
  parse,
  unreadable,
}: BookmarkFormat<Reason>) => {
  const read: ImportReader = async (file, cell, tally, heard) => {
    const parsed = parse(await file.text());

    if (!parsed.ok) {
      throw new ImportStoppedError(unreadable[parsed.reason]);
    }

    const plan = planBookmarks(parsed.rows, Date.now());
    tally.alreadySaved += plan.duplicates;
    tally.total = parsed.rows.length;
    heard();
    const batcher = createBatcher(cell, tally, heard);

    for (const item of plan.items) {
      const noted =
        item.note === "" ? { blocks: [], refused: 0 } : webNoteBlocks(item.note, newBlockId);

      if (noted === null || noted.refused > 0) {
        tally.unreadable += 1;
      } else {
        await batcher.add({
          blocks: [...noted.blocks, ...highlightBlocks(item.highlights, newBlockId)].map(
            (block) => ({ block, section: "note" }),
          ),
          cover: item.cover,
          fields: bookmarkFields(item),
          folder: item.folder === null ? null : importFolder(item.folder),
          id: newId(),
          kind: "new",
        });
      }
    }

    await batcher.flush();
  };

  return read;
};
