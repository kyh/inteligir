import { refusalText } from "@repo/contract/rpc/refusal-text";

import { readBookmarksHtml } from "./bookmarks-import";
import { freshTally, ImportStoppedError } from "./import-landing";
import type { ImportCell, ImportTally } from "./import-landing";
import type { ImportAsk, ImportCounts, ImportNews, ImportSource } from "./import-news";
import { readMarkdownZip } from "./markdown-import";
import { readRaindropCsv } from "./raindrop-import";

const IMPORT_INTERRUPTED =
  "The import stopped before it finished. Choose the file again to carry on; what it added stays.";

type Reader = (
  file: Blob,
  cell: ImportCell,
  tally: ImportTally,
  heard: () => void,
) => Promise<void>;

const READERS: Readonly<Record<ImportSource, Reader>> = {
  bookmarks: readBookmarksHtml,
  markdown: readMarkdownZip,
  raindrop: readRaindropCsv,
};

const countsOf = ({ added, alreadySaved, unreadable }: ImportTally) =>
  ({
    added,
    alreadySaved,
    unreadable,
  }) satisfies ImportCounts;

export const readImport = async (
  ask: ImportAsk,
  cell: ImportCell,
  tell: (news: ImportNews) => void,
) => {
  const tally = freshTally();
  tell({ kind: "reading" });

  const heard = () => {
    tell(
      tally.total === null
        ? { kind: "reading" }
        : { counts: countsOf(tally), kind: "landing", total: tally.total },
    );
  };

  try {
    await READERS[ask.source](ask.file, cell, tally, heard);
    tell({ counts: countsOf(tally), kind: "done" });
  } catch (error) {
    tell({
      counts: countsOf(tally),
      kind: "failed",
      message:
        error instanceof ImportStoppedError
          ? error.message
          : refusalText(error, IMPORT_INTERRUPTED),
    });
  }
};
