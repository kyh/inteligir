// What reading a file asks of the library (`library.imports.*` and the files' route), and the items
// it reads landed a batch at a time. Each item is parsed against the row before it goes, since the
// library refuses a whole batch over one malformed item, and one whose body is past what a body
// holds is counted unreadable here, since it could not land. A batch carries at most the row's
// hundred items and BATCH_MAX_BYTES of them, so one call stays under the request a function takes.

import { importedItemSchema } from "@repo/contract/rpc/library-contract";
import type { IMPORT_STANDINGS } from "@repo/contract/library/library-wire";
import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import {
  BODY_MAX_BYTES,
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

// past this many UTF-8 bytes, a batch goes before the next item joins it: under Vercel's 4.5 MB
// request with the call around it, and above any one item, whose body is at most BODY_MAX_BYTES
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

// each of `all` read with at most `size` reads under way, answered in its order; once a read
// throws, no read starts after it, and its failure is thrown once those under way have ended
export const inPool = async <T, A>(
  all: readonly T[],
  size: number,
  read: (one: T) => Promise<A>,
): Promise<A[]> => {
  const queue = all.entries();
  const answers: (readonly [number, A])[] = [];
  const failures: { readonly error: unknown }[] = [];
  const lane = async (): Promise<void> => {
    while (failures.length === 0) {
      const next = queue.next();
      if (next.done === true) {
        return;
      }
      const [index, one] = next.value;
      try {
        answers.push([index, await read(one)]);
      } catch (error) {
        failures.push({ error });
      }
    }
  };
  await Promise.all(
    Array.from({ length: size }, async () => {
      await lane();
    }),
  );
  const [failure] = failures;
  if (failure !== undefined) {
    throw failure.error;
  }
  return answers.toSorted(([one], [other]) => one - other).map(([, answer]) => answer);
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
    if (
      parsed.data.kind === "new" &&
      utf8ByteLength(JSON.stringify(parsed.data.blocks)) > BODY_MAX_BYTES
    ) {
      tally.unreadable += 1;
      return;
    }
    const size = utf8ByteLength(JSON.stringify(parsed.data));
    if (batch.length >= BULK_ITEMS_MAX || (batch.length > 0 && bytes + size > BATCH_MAX_BYTES)) {
      await flush();
    }
    batch.push(parsed.data);
    bytes += size;
  };
  return { add, flush };
};
