import { keptFileType } from "@repo/contract/items/item-kind";
import type { ListingFolder } from "@repo/contract/library/folder-rail";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { exportWriter, heldShas } from "@repo/editor/headless/codec/item-export";
import { BlobReader, TextReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";

import type { ExportCell, WholeItem } from "./export-cell";
import type { ExportAsk, ExportCounts, ExportNews } from "./export-news";

export const EXPORT_INTERRUPTED = "The export stopped before it finished. Try again.";

const ZIP_TYPE = "application/zip";

const ITEMS_AHEAD = 4;

const STORED = { level: 0 } as const;

type Settled<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: unknown };

const settled = async <A>(reading: Promise<A>) => {
  try {
    return { ok: true, value: await reading } satisfies Settled<A>;
  } catch (error) {
    return { error, ok: false } satisfies Settled<A>;
  }
};

const inOrderAhead = async <T, A>(
  all: readonly T[],
  ahead: number,
  read: (one: T) => Promise<A>,
  take: (answer: A) => Promise<void>,
) => {
  const queue = all.values();
  const pending: Promise<Settled<A>>[] = [];

  const startNext = () => {
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

const listLibrary = async (cell: ExportCell) => {
  const titles = new Map<string, string>();

  for (let cursor: number | null = 0; cursor !== null;) {
    const page = await cell.listed(cursor);

    for (const { fields, id } of page.items) {
      titles.set(id, fields.title);
    }

    ({ cursor } = page);
  }

  return titles satisfies ReadonlyMap<string, string>;
};

const folderNamesOf = (folders: readonly ListingFolder[]) => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  return ((id) => {
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
  }) satisfies (id: string | null) => string[];
};

const writeZip = async (
  cell: ExportCell,
  writable: WritableStream<Uint8Array>,
  counts: ExportCounts,
  tell: (news: ExportNews) => void,
) => {
  const [titles, folders] = await Promise.all([listLibrary(cell), cell.folders()]);
  const folderNames = folderNamesOf(folders);
  const total = titles.size;
  tell({ kind: "writing", total, written: 0 });
  const types = new Map<string, string>();
  const missing = new Set<string>();
  const written = new Set<string>();

  const write = exportWriter({
    title: (itemId) => titles.get(itemId) ?? null,
    typeOf: (sha) => types.get(sha) ?? keptFileType(""),
  });

  const readFile = async (sha: string) => {
    const bytes = await cell.file(sha);

    if (bytes === null) {
      missing.add(sha);
    } else {
      types.set(sha, keptFileType(bytes.type));
    }

    return bytes satisfies Blob | null;
  };

  const zip = new ZipWriter(writable);

  const writeItem = async (item: WholeItem | null) => {
    if (item === null || item.fields.deletedAt !== null) {
      return;
    }

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

const zipTarget = async (ask: ExportAsk) => {
  if (ask.kind === "file") {
    return { writable: await ask.handle.createWritable(), zip: null } satisfies {
      writable: WritableStream<Uint8Array>;
      zip: Promise<Blob> | null;
    };
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

  return {
    writable,
    zip: new Response(readable, { headers: { "content-type": ZIP_TYPE } }).blob(),
  } satisfies { writable: WritableStream<Uint8Array>; zip: Promise<Blob> | null };
};

export const exportLibrary = async (
  ask: ExportAsk,
  cell: ExportCell,
  tell: (news: ExportNews) => void,
) => {
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
