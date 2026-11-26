import { newId } from "../cloud/new-id";
import { createBatcher, importFolder, ImportStoppedError } from "./import-landing";
import type { ImportCell, ImportTally } from "./import-landing";
import { parseBookmarksHtml } from "./bookmarks-plan";
import { bookmarkFields, planRaindropImport } from "./raindrop-plan";

const UNREADABLE: Readonly<Record<"not-bookmarks" | "empty", string>> = {
  empty: "This file has no bookmarks in it.",
  "not-bookmarks":
    "This file isn't a browser's bookmarks. In Chrome, open the bookmarks manager and choose Export bookmarks from its ⋮ menu; in Safari, choose File › Export › Bookmarks; in Firefox, choose Export Bookmarks to HTML in the Library.",
};

export const readBookmarksHtml = async (
  file: Blob,
  cell: ImportCell,
  tally: ImportTally,
  heard: () => void,
) => {
  const parsed = parseBookmarksHtml(await file.text());

  if (!parsed.ok) {
    throw new ImportStoppedError(UNREADABLE[parsed.reason]);
  }

  const plan = planRaindropImport(parsed.rows, Date.now());
  tally.alreadySaved += plan.duplicates;
  tally.total = parsed.rows.length;
  heard();
  const batcher = createBatcher(cell, tally, heard);

  for (const item of plan.items) {
    await batcher.add({
      blocks: [],
      cover: null,
      fields: bookmarkFields(item),
      folder: item.folder === null ? null : importFolder(item.folder),
      id: newId(),
      kind: "new",
    });
  }

  await batcher.flush();
};
