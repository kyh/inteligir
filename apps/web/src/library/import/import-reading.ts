// An import read on its own thread, start to end: the reader its source names, and what it came to
// told as it goes, so the page draws it and Stop ends the thread wherever it stands.

import { refusalText } from "@repo/contract/refusal-text";

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
  markdown: readMarkdownZip,
  raindrop: readRaindropCsv,
};

const countsOf = ({ added, alreadySaved, unreadable }: ImportTally): ImportCounts => ({
  added,
  alreadySaved,
  unreadable,
});

export const readImport = async (
  ask: ImportAsk,
  cell: ImportCell,
  tell: (news: ImportNews) => void,
): Promise<void> => {
  const tally = freshTally();
  tell({ kind: "reading" });
  const heard = (): void => {
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
