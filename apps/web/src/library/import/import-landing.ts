// What reading a file asks of the library (`library.imports.*` and the files' route), and the items
// it reads landed a batch at a time. Each item is parsed against the row before it goes, since the
// cell refuses a whole batch over one malformed item, and a batch carries at most the row's hundred
// items and BATCH_MAX_BYTES of them, so one call never carries a whole library.

import { importedItemSchema } from "@repo/contract/library/library-contract";
import type { IMPORT_STANDINGS } from "@repo/contract/library/library-wire";
import {
  BULK_ITEMS_MAX,
  FOLDER_NAME_MAX,
  folderPathNames,
} from "@repo/contract/library/library-wire";
import type { z } from "zod";

import type { ImportCounts } from "./import-news";

export type ImportedItem = z.infer<typeof importedItemSchema>;

export interface NoteStanding {
  readonly id: string;
  readonly standing: (typeof IMPORT_STANDINGS)[number];
}

interface NamedFiles {
  readonly named: readonly string[];
  readonly originals: readonly string[];
}

// the library as an import reaches it; a call that cannot go on throws, an `ImportStoppedError` saying
// why in the person's words
export interface ImportCell {
  readonly settle: (
    notes: readonly { readonly id: string; readonly url: string | null }[],
  ) => Promise<readonly NoteStanding[]>;
  readonly named: (shas: readonly string[]) => Promise<NamedFiles>;
  readonly land: (items: readonly ImportedItem[]) => Promise<ImportCounts>;
  // a file's bytes in the library's files, by their sha, or null for bytes it refused
  readonly keep: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Promise<string | null>;
}

export class ImportStoppedError extends Error {
  override name = "ImportStoppedError";
}

export const LIBRARY_FULL =
  "Your library is full, so the import stopped. Free some room and import again.";

// what an import came to so far, and how many items it means to land, null while it reads
export interface ImportTally {
  added: number;
  alreadySaved: number;
  unreadable: number;
  total: number | null;
}

export const freshTally = (): ImportTally => ({
  added: 0,
  alreadySaved: 0,
  total: null,
  unreadable: 0,
});

// past this, a batch goes before the next item joins it; an item larger on its own goes alone
const BATCH_MAX_BYTES = 4 * 1024 * 1024;

// a folder's path as the library names folders: each name cut to what one holds
export const importFolder = (path: string): string | null => {
  const names = folderPathNames(path).map((name) => name.slice(0, FOLDER_NAME_MAX).trim());
  return names.length === 0 ? null : names.join("/");
};

// the call's own chunks, in order, each answered before the next asks
export const inChunks = async <T, A>(
  all: readonly T[],
  ask: (chunk: readonly T[]) => Promise<readonly A[]>,
): Promise<A[]> => {
  const answers: A[] = [];
  for (let start = 0; start < all.length; start += BULK_ITEMS_MAX) {
    answers.push(...(await ask(all.slice(start, start + BULK_ITEMS_MAX))));
  }
  return answers;
};

export interface Batcher {
  readonly add: (item: ImportedItem) => Promise<void>;
  readonly flush: () => Promise<void>;
}

export const createBatcher = (cell: ImportCell, tally: ImportTally, heard: () => void): Batcher => {
  let batch: ImportedItem[] = [];
  let bytes = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) {
      return;
    }
    const sent = batch;
    batch = [];
    bytes = 0;
    const landed = await cell.land(sent);
    tally.added += landed.added;
    tally.alreadySaved += landed.alreadySaved;
    tally.unreadable += landed.unreadable;
    heard();
  };
  const add = async (item: ImportedItem): Promise<void> => {
    const parsed = importedItemSchema.safeParse(item);
    if (!parsed.success) {
      tally.unreadable += 1;
      return;
    }
    const size = JSON.stringify(parsed.data).length;
    if (batch.length >= BULK_ITEMS_MAX || (batch.length > 0 && bytes + size > BATCH_MAX_BYTES)) {
      await flush();
    }
    batch.push(parsed.data);
    bytes += size;
  };
  return { add, flush };
};
