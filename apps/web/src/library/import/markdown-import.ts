// A zip of markdown read into the library, this app's export or an Obsidian vault, by the codec's
// plan (`@repo/editor/headless/codec/import-plan`): pass one lists the zip, keeps each note's frontmatter and
// sends every file up by its sha; the cell says how each planned note stands; pass two reads each
// new note whole and lands it; last, every file no item names becomes an item of its own. An item's
// id comes from the zip's listing and its path, so reading the same zip again lands nothing twice.

import { dirnamePath } from "@repo/contract/knowledge/folder-path";
import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { fileSha } from "@repo/contract/library/file-sha";
import {
  fileTypeOf,
  importPathKind,
  importPlannedDoc,
  openPlan,
  planFileItems,
  planImport,
  unwrapExport,
} from "@repo/editor/headless/codec/import-plan";
import type { ImportEntry, PlanIds, PlannedDoc } from "@repo/editor/headless/codec/import-plan";
import { frontmatterEnd } from "@repo/editor/headless/markdown/frontmatter";
import { lfOnly } from "@repo/editor/headless/markdown/md-read";
import { BlobReader, ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import type { FileEntry } from "@zip.js/zip.js/lib/zip-core-native.js";

import { createBatcher, importFolder, ImportStoppedError, inChunks } from "./import-landing";
import type { ImportCell, ImportTally, NoteStanding } from "./import-landing";

export const NOT_A_ZIP =
  "This file isn't a zip of notes. Choose a .zip of a folder of Markdown files, such as your Obsidian folder.";

// reading a note costs about 10 s of CPU a MiB of markdown, and more than linearly past it, so a
// longer one is left out as unreadable rather than stall the import on it
const NOTE_MAX_BYTES = 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Listed {
  readonly path: string;
  readonly entry: FileEntry;
}

interface SettledDoc {
  readonly doc: PlannedDoc;
  readonly standing: NoteStanding["standing"];
}

// a version 8 UUID (RFC 9562 § 5.8) from the zip and the path, the same each time the zip is read
const importItemId = (fingerprint: string, path: string): string => {
  const hex = fileSha(encoder.encode(`${fingerprint}\n${path}`));
  const variant = "89ab".charAt(Number.parseInt(hex.charAt(16), 16) % 4);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
};

// the zip's files, or null for a file that is no zip
const listZip = async (file: Blob): Promise<readonly Listed[] | null> => {
  try {
    const entries = await new ZipReader(new BlobReader(file)).getEntries();
    return entries.flatMap((entry) => (entry.directory ? [] : [{ entry, path: entry.filename }]));
  } catch {
    return null;
  }
};

// an entry's bytes, or null for one the zip cannot give back: encrypted, compressed some other way
// or damaged
const bytesOf = async (entry: FileEntry): Promise<Uint8Array<ArrayBuffer> | null> => {
  try {
    return new Uint8Array(await entry.arrayBuffer());
  } catch {
    return null;
  }
};

const textOf = async (entry: FileEntry): Promise<string | null> => {
  const bytes = await bytesOf(entry);
  return bytes === null ? null : decoder.decode(bytes);
};

const frontmatterOf = (text: string): string => {
  const lines = lfOnly(text);
  return lines.slice(0, frontmatterEnd(lines) ?? 0);
};

// pass one's reading of a path: a note's frontmatter, or a file kept by its sha
const readListed = async (
  cell: ImportCell,
  { entry, path }: Listed,
): Promise<ImportEntry | "skipped" | "unreadable"> => {
  const kind = importPathKind(path);
  switch (kind) {
    case "skipped": {
      return kind;
    }
    case "doc": {
      const text = entry.uncompressedSize > NOTE_MAX_BYTES ? null : await textOf(entry);
      return text === null ? "unreadable" : { kind, path, text: frontmatterOf(text) };
    }
    case "file": {
      const bytes = entry.uncompressedSize > BLOB_MAX_BYTES ? null : await bytesOf(entry);
      const sha = bytes === null ? null : await cell.keep(bytes, fileTypeOf(path));
      return sha === null ? "unreadable" : { kind, path, sha };
    }
    // no default
  }
};

const settleDocs = async (cell: ImportCell, docs: readonly PlannedDoc[]): Promise<SettledDoc[]> =>
  await inChunks(docs, async (chunk) => {
    const notes = await cell.settle(chunk.map((doc) => ({ id: doc.itemId, url: doc.url })));
    return chunk.map((doc, index) => {
      const note = notes[index];
      if (note === undefined) {
        throw new Error("the library answered fewer notes than it was asked about");
      }
      return { doc: { ...doc, itemId: note.id }, standing: note.standing };
    });
  });

export const readMarkdownZip = async (
  file: Blob,
  cell: ImportCell,
  tally: ImportTally,
  heard: () => void,
): Promise<void> => {
  const listing = await listZip(file);
  if (listing === null) {
    throw new ImportStoppedError(NOT_A_ZIP);
  }
  const fingerprint = fileSha(
    encoder.encode(
      JSON.stringify(listing.map(({ entry, path }) => [path, entry.crc32, entry.uncompressedSize])),
    ),
  );
  const ids: PlanIds = { newItemId: (path) => importItemId(fingerprint, path) };
  const entries: ImportEntry[] = [];
  const notes = new Map<string, FileEntry>();
  for (const listed of unwrapExport(listing)) {
    const read = await readListed(cell, listed);
    if (read === "unreadable") {
      tally.unreadable += 1;
    } else if (read !== "skipped") {
      entries.push(read);
      if (read.kind === "doc") {
        notes.set(read.path, listed.entry);
      }
    }
  }
  const plan = planImport(entries, ids);
  const settled = await settleDocs(cell, plan.docs);
  tally.total = settled.length;
  heard();
  const reader = openPlan({ docs: settled.map(({ doc }) => doc), files: plan.files });
  const batcher = createBatcher(cell, tally, heard);
  for (const { doc, standing } of settled) {
    if (standing === "held") {
      tally.alreadySaved += 1;
    } else if (standing === "deleted") {
      await batcher.add({ id: doc.itemId, kind: "restore" });
    } else {
      const entry = notes.get(doc.path);
      const text = entry === undefined ? null : await textOf(entry);
      const read =
        text === null
          ? null
          : importPlannedDoc(reader, doc, text, {
              newBlockId: () => crypto.randomUUID(),
              now: Date.now(),
            });
      if (read?.ok === true) {
        tally.unreadable += read.read.item.leftOut;
        await batcher.add({
          blocks: [...read.read.item.blocks],
          cover: null,
          fields: read.read.item.fields,
          folder: importFolder(dirnamePath(doc.path)),
          id: doc.itemId,
          kind: "new",
        });
      } else {
        tally.unreadable += 1;
      }
    }
  }
  await batcher.flush();
  const named = await inChunks(
    [...new Set(plan.files.map((planned) => planned.sha))],
    async (shas) => [await cell.named(shas)],
  );
  const fileItems = planFileItems(
    plan,
    {
      attached: new Set(named.flatMap((answer) => answer.named)),
      originals: new Set(named.flatMap((answer) => answer.originals)),
    },
    ids,
    Date.now(),
  );
  tally.total = settled.length + fileItems.length;
  heard();
  for (const item of fileItems) {
    await batcher.add({
      blocks: [],
      cover: null,
      fields: item.fields,
      folder: importFolder(item.folderPath),
      id: item.itemId,
      kind: "new",
    });
  }
  await batcher.flush();
};
