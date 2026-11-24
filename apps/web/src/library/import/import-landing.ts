import { importedItemSchema } from "@repo/contract/rpc/library-contract";
import type { IMPORT_STANDINGS } from "@repo/contract/library/library-wire";
import { utf8ByteLength } from "@repo/contract/bytes";
import {
  BODY_MAX_BYTES,
  bodyBytes,
  BULK_ITEMS_MAX,
  FOLDER_NAME_MAX,
  folderPathNames,
} from "@repo/contract/library/library-wire";
import type { z } from "zod";

import type { ImportCounts } from "./import-news";

export type ImportedItem = z.infer<typeof importedItemSchema>;

interface NoteStanding {
  readonly id: string;
  readonly standing: (typeof IMPORT_STANDINGS)[number];
}

interface NamedFiles {
  readonly named: readonly string[];
  readonly originals: readonly string[];
}

export interface ImportCell {
  readonly settle: (
    notes: readonly { readonly id: string; readonly url: string | null }[],
  ) => Promise<readonly NoteStanding[]>;
  readonly named: (shas: readonly string[]) => Promise<NamedFiles>;
  readonly land: (items: readonly ImportedItem[]) => Promise<ImportCounts>;
  readonly keep: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Promise<string | null>;
}

export class ImportStoppedError extends Error {
  override name = "ImportStoppedError";
}

export const LIBRARY_FULL =
  "Your library is full, so the import stopped. Free some room and import again.";

export interface ImportTally {
  added: number;
  alreadySaved: number;
  unreadable: number;
  total: number | null;
}

export const freshTally = () =>
  ({
    added: 0,
    alreadySaved: 0,
    total: null,
    unreadable: 0,
  }) satisfies ImportTally;

const BATCH_MAX_BYTES = 4 * 1024 * 1024;

export const importFolder = (path: string) => {
  const names = folderPathNames(path).map((name) => name.slice(0, FOLDER_NAME_MAX).trim());

  return names.length === 0 ? null : names.join("/");
};

export const inChunks = async <T, A>(
  all: readonly T[],
  ask: (chunk: readonly T[]) => Promise<readonly A[]>,
) => {
  const answers: A[] = [];

  for (let start = 0; start < all.length; start += BULK_ITEMS_MAX) {
    answers.push(...(await ask(all.slice(start, start + BULK_ITEMS_MAX))));
  }

  return answers;
};

export const inPool = async <T, A>(
  all: readonly T[],
  size: number,
  read: (one: T) => Promise<A>,
) => {
  const queue = all.entries();
  const answers: (readonly [number, A])[] = [];
  const failures: { readonly error: unknown }[] = [];

  const lane = async () => {
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

interface Batcher {
  readonly add: (item: ImportedItem) => Promise<void>;
  readonly flush: () => Promise<void>;
}

export const createBatcher = (cell: ImportCell, tally: ImportTally, heard: () => void) => {
  let batch: ImportedItem[] = [];
  let bytes = 0;

  const flush = async () => {
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

  const add = async (item: ImportedItem) => {
    const parsed = importedItemSchema.safeParse(item);

    if (!parsed.success) {
      tally.unreadable += 1;

      return;
    }

    if (parsed.data.kind === "new" && bodyBytes(parsed.data.blocks) > BODY_MAX_BYTES) {
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

  return { add, flush } satisfies Batcher;
};
