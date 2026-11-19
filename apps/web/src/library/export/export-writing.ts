// The library written as a zip an import reads back, on the export's own thread, start to end:
// every live item listed first, so a link names an item further on by its title, then each read
// whole a few ahead and written by the codec (`@repo/editor/headless/codec/item-export`), its
// files after it, each path once. The zip streams into the file the person chose, or into a blob
// handed back for a download. What it came to is told as it goes, so the page draws it and Stop
// ends the thread wherever it stands.

import { keptFileType } from "@repo/contract/items/item-kind";
import type { ListingFolder } from "@repo/contract/library/folder-rail";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { exportWriter, heldShas } from "@repo/editor/headless/codec/item-export";
import { BlobReader, TextReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";

import type { ExportCell, WholeItem } from "./export-cell";
import type { ExportAsk, ExportCounts, ExportNews } from "./export-news";

export const EXPORT_INTERRUPTED = "The export stopped before it finished. Try again.";

const ZIP_TYPE = "application/zip";

// items read ahead of the one being written, so one's round trip overlaps another's writing
const ITEMS_AHEAD = 4;

// a file's bytes are stored as they are: most are pictures, PDFs and recordings, compressed already
const STORED = { level: 0 } as const;

type Settled<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: unknown };

const settled = async <A>(reading: Promise<A>): Promise<Settled<A>> => {
  try {
    return { ok: true, value: await reading };
  } catch (error) {
    return { error, ok: false };
  }
};

// each of `all` read with up to `ahead` reads under way and handed to `take` in order, the next
// read starting as `take` takes one; a read that failed throws at its turn, and none starts after
const inOrderAhead = async <T, A>(
  all: readonly T[],
  ahead: number,
  read: (one: T) => Promise<A>,
  take: (answer: A) => Promise<void>,
): Promise<void> => {
  const queue = all.values();
  const pending: Promise<Settled<A>>[] = [];
  const startNext = (): void => {
    const next = queue.next();
    if (next.done !== true) {
      pending.push(settled(read(next.value)));
    }
  };
  for (let started = 0; started < ahead; started += 1) {
    startNext();
  }
  for (let reading = pending.shift(); reading !== undefined; reading = pending.shift()) {
    const answer = await reading;
    if (!answer.ok) {
      throw answer.error;
    }
    startNext();
    await take(answer.value);
  }
};

// every live item's id and title, in the listing's order; an item a moving page lists twice, once
const listLibrary = async (cell: ExportCell): Promise<ReadonlyMap<string, string>> => {
  const titles = new Map<string, string>();
  for (let cursor: number | null = 0; cursor !== null;) {
    const page = await cell.listed(cursor);
    for (const { fields, id } of page.items) {
      titles.set(id, fields.title);
    }
    ({ cursor } = page);
  }
  return titles;
};

// a live folder's names from the top, by its id; none for an item filed nowhere
const folderNamesOf = (folders: readonly ListingFolder[]): ((id: string | null) => string[]) => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return (id) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (
      let folder = id === null ? undefined : byId.get(id);
      folder !== undefined && !seen.has(folder.id);
      folder = folder.parentId === null ? undefined : byId.get(folder.parentId)
    ) {
      seen.add(folder.id);
      names.unshift(folder.name);
    }
    return names;
  };
};

const writeZip = async (
  cell: ExportCell,
  writable: WritableStream<Uint8Array>,
  counts: ExportCounts,
  tell: (news: ExportNews) => void,
): Promise<void> => {
  const [titles, folders] = await Promise.all([listLibrary(cell), cell.folders()]);
  const folderNames = folderNamesOf(folders);
  const total = titles.size;
  tell({ kind: "writing", total, written: 0 });
  // a file's type, learned once from its bytes, and the files the library no longer holds
  const types = new Map<string, string>();
  const missing = new Set<string>();
  const written = new Set<string>();
  const write = exportWriter({
    title: (itemId) => titles.get(itemId) ?? null,
    typeOf: (sha) => types.get(sha) ?? keptFileType(""),
  });
  const readFile = async (sha: string): Promise<Blob | null> => {
    const bytes = await cell.file(sha);
    if (bytes === null) {
      missing.add(sha);
    } else {
      types.set(sha, keptFileType(bytes.type));
    }
    return bytes;
  };
  const zip = new ZipWriter(writable);
  const writeItem = async (item: WholeItem | null): Promise<void> => {
    // an item deleted or purged since the listing is no longer the library's
    if (item === null || item.fields.deletedAt !== null) {
      return;
    }
    // the files whose type the codec names them by, read before it writes
    const read = new Map<string, Blob | null>();
    for (const sha of heldShas(item)) {
      if (!types.has(sha) && !missing.has(sha)) {
        read.set(sha, await readFile(sha));
      }
    }
    const file = write({ ...item, folder: folderNames(item.fields.folderId) });
    await zip.add(file.path, new TextReader(file.text));
    for (const { path, sha } of file.files) {
      if (!written.has(path) && !missing.has(sha)) {
        const bytes = read.get(sha) ?? (await readFile(sha));
        if (bytes !== null) {
          await zip.add(path, new BlobReader(bytes), STORED);
          written.add(path);
        }
      }
    }
    counts.items += 1;
    counts.propertiesLeftOut += file.leftOut;
    tell({ kind: "writing", total, written: counts.items });
  };
  await inOrderAhead([...titles.keys()], ITEMS_AHEAD, cell.item, writeItem);
  counts.filesMissing = missing.size;
  await zip.close();
};

// where the zip's bytes go: the chosen file's stream, or a blob read off a stream of its own
const zipTarget = async (
  ask: ExportAsk,
): Promise<{ writable: WritableStream<Uint8Array>; zip: Promise<Blob> | null }> => {
  if (ask.kind === "file") {
    return { writable: await ask.handle.createWritable(), zip: null };
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  return {
    writable,
    zip: new Response(readable, { headers: { "content-type": ZIP_TYPE } }).blob(),
  };
};

export const exportLibrary = async (
  ask: ExportAsk,
  cell: ExportCell,
  tell: (news: ExportNews) => void,
): Promise<void> => {
  const counts: ExportCounts = { filesMissing: 0, items: 0, propertiesLeftOut: 0 };
  tell({ kind: "listing" });
  try {
    const target = await zipTarget(ask);
    await writeZip(cell, target.writable, counts, tell);
    tell({ counts, kind: "done", zip: target.zip === null ? null : await target.zip });
  } catch (error) {
    tell({ counts, kind: "failed", message: refusalText(error, EXPORT_INTERRUPTED) });
  }
};
