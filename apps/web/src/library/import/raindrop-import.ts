import { webNoteBlocks } from "@repo/editor/headless/codec/item-markdown";

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

const newBlockId = () => crypto.randomUUID();

export const readRaindropCsv = async (
  file: Blob,
  cell: ImportCell,
  tally: ImportTally,
  heard: () => void,
) => {
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
