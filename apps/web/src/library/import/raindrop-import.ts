// A Raindrop export read into the library (`./raindrop-plan`): every bookmark lands as an unread
// link, its tags and folder Raindrop's, its note and its highlights the item's note, its page read
// by the cloud after it, Raindrop's own picture tried after the page's. An address the library
// holds already is counted, never saved twice, so reading the same export again lands nothing
// twice.

import { webNoteBlocks } from "@repo/editor/codec/item-markdown";

import { newId } from "../library/new-id";
import { createBatcher, importFolder, ImportStoppedError } from "./import-landing";
import type { ImportCell, ImportTally } from "./import-landing";
import {
  bookmarkFields,
  highlightBlocks,
  parseRaindropCsv,
  planRaindropImport,
} from "./raindrop-plan";

const UNREADABLE: Readonly<Record<"not-csv" | "no-url-column" | "empty", string>> = {
  empty: "This file has no bookmarks in it.",
  "no-url-column":
    "This file isn't a Raindrop export: it has no column of web addresses. In Raindrop, open Settings › Backups, create a backup and choose its CSV file.",
  "not-csv":
    "This file isn't a Raindrop export. In Raindrop, open Settings › Backups, create a backup and choose its CSV file.",
};

const newBlockId = (): string => crypto.randomUUID();

export const readRaindropCsv = async (
  file: Blob,
  cell: ImportCell,
  tally: ImportTally,
  heard: () => void,
): Promise<void> => {
  const parsed = parseRaindropCsv(await file.text());
  if (!parsed.ok) {
    throw new ImportStoppedError(UNREADABLE[parsed.reason]);
  }
  const plan = planRaindropImport(parsed.rows, Date.now());
  tally.alreadySaved += plan.duplicates;
  tally.total = parsed.rows.length;
  heard();
  const batcher = createBatcher(cell, tally, heard);
  for (const item of plan.items) {
    // the person's note is their own markdown, its links addresses on the web
    const noted =
      item.note === "" ? { blocks: [], refused: 0 } : webNoteBlocks(item.note, newBlockId);
    if (noted === null || noted.refused > 0) {
      tally.unreadable += 1;
    } else {
      await batcher.add({
        blocks: [...noted.blocks, ...highlightBlocks(item.highlights, newBlockId)].map((block) => ({
          block,
          section: "note",
        })),
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
