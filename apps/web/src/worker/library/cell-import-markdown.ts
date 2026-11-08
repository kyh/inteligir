// A zip of markdown read into the library: this app's export, an Obsidian vault, or any
// folder of notes, by the codec's two-pass plan (`@repo/editor/codec/import-plan`). The first runs
// walk the zip's directory, keeping each note's frontmatter and putting every file in the library
// under its sha; then the plan is made once, every note's item
// and id minted and kept, an address or an id the library holds already standing for its item.
// Later runs land a page of notes at a time, each read whole against the plan, and last every file
// no item names becomes an item of its own. Every run reads the zip where it lies in R2, a range
// at a time.

import { hexFromBytes } from "@repo/contract/cloud/bytes";
import { BLOB_MAX_BYTES } from "@repo/contract/cloud/library/library-blobs";
import {
  importPathKind,
  importPlannedDoc,
  openPlan,
  planFileItems,
  planImport,
  unwrapExport,
} from "@repo/editor/codec/import-plan";
import type {
  ImportEntry,
  ImportPlan,
  PlannedDoc,
  ReadFiles,
} from "@repo/editor/codec/import-plan";
import {
  LIBRARY_RULES_PATH,
  mediaTypeOfName,
  UNKNOWN_FILE_TYPE,
} from "@repo/notes/items/item-kind";
import { urlKey } from "@repo/notes/items/item-url";
import { dirnamePath, normalizePath } from "@repo/notes/knowledge/folder-path";
import { libraryItemFieldsSchema } from "@repo/notes/library/library-item";
import { readItem } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { frontmatterEnd } from "@repo/notes/markdown/frontmatter";
import { z } from "zod";

import { openZipEntry, readZipEntries, readZipEntry, ZipError } from "../zip/zip-read";
import type { ByteSource, ZipEntry } from "../zip/zip-read";
import { r2Source } from "../zip/r2-source";
import { blobKey } from "./cell-blobs";
import { askFill } from "./cell-fills";
import { folderOfTarget } from "./cell-folders";
import {
  apart,
  DONE,
  failed,
  FILE_GONE,
  importActor,
  keepFile,
  landingOutcome,
  LIBRARY_FULL,
  MORE,
  passOver,
  PAGE_MS,
} from "./cell-import-host";
import type { ImportHost, StepOutcome } from "./cell-import-host";
import {
  advanceImport,
  dropImportRows,
  fitsImportRow,
  importRows,
  putImportRows,
} from "./cell-import-jobs";
import type { ImportJob, ImportStep } from "./cell-import-jobs";
import { landNew, setDeleted } from "./cell-items";
import { ITEM_TEXT_MAX_BYTES, urlHolder } from "./cell-landing";
import type { LandingScope } from "./cell-landing";
import type { CellStorage } from "./cell-storage";
import { filingRules } from "./library-rules";

// a file read whole to hash it; a larger one is read twice, once to hash it and once to store it
const BUFFERED_MAX_BYTES = 8 * 1024 * 1024;
// what one run of the first pass reads of the zip, its files' bytes and its notes' text, at least
// one path a run: reading costs the platform's own inflate and digest, a few ms a MiB
const READ_PAGE_BYTES = 64 * 1024 * 1024;
// reading a note into its item costs about 10 s of CPU a MiB of markdown, and more than linearly
// past it (2.3 s for 256 KiB, 63 s for 4 MiB, measured in node on the build's runner), so one run
// lands notes until it has read this much of them, at least one, and a note past NOTE_MAX_BYTES is
// left out as unreadable rather than end every run that tries it
const LAND_PAGE_BYTES = 512 * 1024;
const NOTE_MAX_BYTES = 1024 * 1024;
// the notes, and the files made items, one run lands
const PAGE_DOCS = 50;
const PAGE_FILES = 100;
// every row of a kind, read at once
const ALL = { from: 0, limit: 1_000_000 } as const;

const NOT_A_ZIP =
  "This file isn't a zip of notes. Choose a .zip of a folder of Markdown files, such as your Obsidian folder.";

const zipEntrySchema = z.object({
  compressedSize: z.number(),
  crc: z.number(),
  encrypted: z.boolean(),
  headerOffset: z.number(),
  index: z.number(),
  method: z.number(),
  path: z.string(),
  size: z.number(),
});

// a path of the zip as the first runs read it; a note keeps its frontmatter alone
const entrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("doc"), path: z.string(), text: z.string(), zip: zipEntrySchema }),
  z.object({ kind: z.literal("file"), path: z.string(), sha: z.string() }),
]);
type Entry = z.infer<typeof entrySchema>;

const plannedDocSchema = z.object({
  aliases: z.array(z.string()),
  fileId: z.string().nullable(),
  itemId: z.string(),
  path: z.string(),
  title: z.string(),
  urlKey: z.string().nullable(),
});

const docRowSchema = z.object({
  doc: plannedDocSchema,
  standing: z.enum(["held", "deleted", "new"]),
  zip: zipEntrySchema,
});
type DocRow = z.infer<typeof docRowSchema>;

const fileRowSchema = z.object({
  kind: z.enum(["image", "pdf", "video", "audio", "file"]),
  path: z.string(),
  sha: z.string(),
});

const fileItemRowSchema = z.object({
  fields: libraryItemFieldsSchema.omit({ deletedAt: true, folderId: true }),
  folderPath: z.string(),
  itemId: z.string(),
});

const ROWS = {
  doc: "doc",
  entry: "entry",
  file: "file",
  fileItem: "file-item",
} as const;

const decoder = new TextDecoder();

const folderIdOf = (scope: LandingScope, host: ImportHost, path: string): string | null =>
  path === "" ? null : (folderOfTarget(scope, { path }, host.library.ids.item) ?? null);

// ---- the first runs: the zip's paths ----

type EntryRead =
  | { readonly kind: "row"; readonly value: Entry }
  | { readonly kind: "held" }
  | { readonly kind: "skipped" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "full" };

const textOf = async (source: ByteSource, entry: ZipEntry, maxBytes: number): Promise<string> =>
  decoder.decode(await readZipEntry(source, entry, maxBytes));

const keepEntryFile = async (
  host: ImportHost,
  source: ByteSource,
  entry: ZipEntry,
): Promise<EntryRead> => {
  if (entry.size > BLOB_MAX_BYTES) {
    return { kind: "unreadable" };
  }
  const mime = mediaTypeOfName(entry.path) ?? UNKNOWN_FILE_TYPE;
  let file: Parameters<typeof keepFile>[1];
  if (entry.size <= BUFFERED_MAX_BYTES) {
    const bytes = await readZipEntry(source, entry, BUFFERED_MAX_BYTES);
    const sha = hexFromBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    file = { body: async () => await Promise.resolve(bytes), mime, sha, size: bytes.byteLength };
  } else {
    const digest = new crypto.DigestStream("SHA-256");
    const hashed = await openZipEntry(source, entry);
    await hashed.pipeTo(digest);
    const sha = hexFromBytes(new Uint8Array(await digest.digest));
    file = {
      body: async () => {
        const stored = await openZipEntry(source, entry);
        return stored.pipeThrough(new FixedLengthStream(entry.size));
      },
      mime,
      sha,
      size: entry.size,
    };
  }
  const kept = await keepFile(host, file);
  if (kept === "full") {
    return { kind: "full" };
  }
  return kept === "kept"
    ? { kind: "row", value: { kind: "file", path: entry.path, sha: file.sha } }
    : { kind: "unreadable" };
};

const rowOf = (entry: ZipEntry, value: Entry): EntryRead =>
  fitsImportRow({ idx: entry.index, value }) ? { kind: "row", value } : { kind: "unreadable" };

// the file an export writes of the filing rules, saying what they say: the library holds that
// already, as a held note, and it never enters the plan, where a link could resolve to an item
// that will not land. Any other text under that name is a note, never rules.
const isRulesHeld = (host: ImportHost, path: string, text: string): boolean => {
  if (normalizePath(path) !== LIBRARY_RULES_PATH) {
    return false;
  }
  const rules = host.library.read(filingRules);
  return rules.ok && rules.value === text;
};

const readEntry = async (
  host: ImportHost,
  source: ByteSource,
  entry: ZipEntry,
): Promise<EntryRead> => {
  const kind = importPathKind(entry.path);
  switch (kind) {
    case "skipped": {
      return { kind: "skipped" };
    }
    case "doc": {
      const text = await textOf(source, entry, ITEM_TEXT_MAX_BYTES);
      if (isRulesHeld(host, entry.path, text)) {
        return { kind: "held" };
      }
      const front = text.slice(0, frontmatterEnd(text) ?? 0);
      return rowOf(entry, { kind, path: entry.path, text: front, zip: entry });
    }
    case "file": {
      return await keepEntryFile(host, source, entry);
    }
    // no default
  }
};

const readEntrySafely = async (
  host: ImportHost,
  source: ByteSource,
  entry: ZipEntry,
): Promise<EntryRead> => {
  try {
    return await readEntry(host, source, entry);
  } catch (error) {
    // one entry the zip cannot give back (encrypted, compressed some other way, corrupt, past
    // what an item holds) is left out, and the rest still read
    if (error instanceof ZipError) {
      return { kind: "unreadable" };
    }
    throw error;
  }
};

// what a path read counts toward
const ENTRY_COUNTS = {
  held: { alreadySaved: 1 },
  row: undefined,
  skipped: { skipped: 1 },
  unreadable: { unreadable: 1 },
} as const;

const importEntryOf = (entry: Entry): ImportEntry =>
  entry.kind === "file"
    ? { kind: "file", path: entry.path, sha: entry.sha }
    : { kind: entry.kind, path: entry.path, text: entry.text };

// a note as the plan lands it: one whose id or address a live item holds is that item (`held`);
// one whose id an item in Deleted holds is that item, come back as it stands (`deleted`), since one
// id names one item and a fresh copy would leave its twin in Deleted; and one whose id a purged
// item kept takes a fresh id (`new`), since the library never reuses one
interface SettledDoc {
  readonly doc: PlannedDoc;
  readonly standing: DocRow["standing"];
}

const settledDoc = (sql: CellStorage, doc: PlannedDoc, newId: () => string): SettledDoc => {
  const item = runPlan(sql, readItem(doc.itemId));
  if (item?.kind === "live" && item.fields.deletedAt === null) {
    return { doc, standing: "held" };
  }
  const holder = doc.urlKey === null ? null : urlHolder(sql, doc.urlKey, null);
  if (holder !== null) {
    return { doc: { ...doc, itemId: holder.id }, standing: "held" };
  }
  if (item?.kind === "live") {
    return { doc, standing: "deleted" };
  }
  return { doc: item === null ? doc : { ...doc, itemId: newId() }, standing: "new" };
};

const writePlan = (scope: LandingScope, host: ImportHost, job: ImportJob): void => {
  const sql = scope.storage;
  const entries = importRows(sql, job.id, ROWS.entry, ALL, entrySchema).map((row) => row.value);
  const zips = new Map(
    entries.flatMap((entry) => (entry.kind === "doc" ? [[entry.path, entry.zip] as const] : [])),
  );
  const plan = planImport(entries.map(importEntryOf), { newItemId: host.library.ids.item });
  putImportRows(
    sql,
    job.id,
    ROWS.doc,
    plan.docs.flatMap((doc, idx) => {
      const zip = zips.get(doc.path);
      return zip === undefined
        ? []
        : [{ idx, value: { ...settledDoc(sql, doc, host.library.ids.item), zip } }];
    }),
  );
  putImportRows(
    sql,
    job.id,
    ROWS.file,
    plan.files.map((value, idx) => ({ idx, value })),
  );
  dropImportRows(sql, job.id, ROWS.entry);
  advanceImport(sql, job.id, { cursor: 0, phase: "landing", total: plan.docs.length });
};

// every file the first pass put in the library for the job, where its rows name them: the paths
// it read while it reads, the plan's files once the plan is made
export const keptFileShas = (sql: SqlStatements, jobId: string): string[] => [
  ...importRows(sql, jobId, ROWS.entry, ALL, entrySchema).flatMap(({ value }) =>
    value.kind === "file" ? [value.sha] : [],
  ),
  ...importRows(sql, jobId, ROWS.file, ALL, fileRowSchema).map(({ value }) => value.sha),
];

const readPaths = async (
  host: ImportHost,
  job: ImportJob,
  startedAt: number,
): Promise<StepOutcome> => {
  const source = await r2Source(host.env.BLOBS, blobKey(host.accountId, job.sha));
  if (source === null) {
    return failed(FILE_GONE);
  }
  let entries: readonly ZipEntry[];
  try {
    entries = unwrapExport(await readZipEntries(source));
  } catch (error) {
    if (error instanceof ZipError) {
      return failed(NOT_A_ZIP);
    }
    throw error;
  }
  let readBytes = 0;
  for (const entry of entries.filter((listed) => listed.index >= job.cursor)) {
    const size = importPathKind(entry.path) === "skipped" ? 0 : entry.size;
    if (readBytes > 0 && readBytes + size > READ_PAGE_BYTES) {
      return MORE;
    }
    readBytes += size;
    const read = await readEntrySafely(host, source, entry);
    if (read.kind === "full") {
      return failed(LIBRARY_FULL);
    }
    const moved = apart(host.library, (scope) => {
      if (read.kind === "row") {
        putImportRows(scope.storage, job.id, ROWS.entry, [{ idx: entry.index, value: read.value }]);
      }
      advanceImport(scope.storage, job.id, {
        counts: ENTRY_COUNTS[read.kind],
        cursor: entry.index + 1,
      });
    });
    if (!moved) {
      return DONE;
    }
    if (host.now() - startedAt > PAGE_MS) {
      return MORE;
    }
  }
  return apart(host.library, (scope) => {
    writePlan(scope, host, job);
  })
    ? MORE
    : DONE;
};

// ---- the plan's runs: the notes, then the files no item names ----

interface LoadedPlan {
  readonly plan: ImportPlan;
  readonly docs: readonly DocRow[];
}

const loadPlan = (sql: SqlStatements, jobId: string): LoadedPlan => {
  const docs = importRows(sql, jobId, ROWS.doc, ALL, docRowSchema).map((row) => row.value);
  return {
    docs,
    plan: {
      docs: docs.map((row) => row.doc),
      files: importRows(sql, jobId, ROWS.file, ALL, fileRowSchema).map((row) => row.value),
    },
  };
};

const LANDED = z.object({ held: z.boolean() });

const CAME_BACK = z.object({ back: z.boolean() });

// a note whose item sits in Deleted: the item back, as Restore brings it back and asking the
// reading of a link still waiting, unless a live item took its address since the plan was made
const restoreDoc = (
  scope: LandingScope,
  job: ImportJob,
  itemId: string,
  idx: number,
): z.input<typeof CAME_BACK> => {
  const restored = setDeleted(scope, { deleted: false, ids: [itemId] });
  for (const item of restored.landed) {
    askFill(scope, item);
  }
  const back = restored.changed.length > 0;
  advanceImport(scope.storage, job.id, {
    changeSetId: back ? scope.set().id : undefined,
    counts: back ? { added: 1 } : { alreadySaved: 1 },
    cursor: idx + 1,
  });
  return { back };
};

const landDoc = (
  scope: LandingScope,
  host: ImportHost,
  read: Extract<ReturnType<typeof importPlannedDoc>, { ok: true }>["read"],
): z.input<typeof LANDED> => {
  const { item, doc } = read;
  const key = item.fields.url === null ? null : urlKey(item.fields.url);
  if (
    runPlan(scope.storage, readItem(doc.itemId))?.kind === "live" ||
    (key !== null && urlHolder(scope.storage, key, null) !== null)
  ) {
    return { held: true };
  }
  const landed = landNew(scope, {
    blocks: item.blocks,
    fields: {
      ...item.fields,
      deletedAt: null,
      folderId: folderIdOf(scope, host, dirnamePath(doc.path)),
    },
    id: doc.itemId,
  });
  askFill(scope, landed);
  return { held: false };
};

const docOutcome = async (
  host: ImportHost,
  job: ImportJob,
  context: {
    readonly source: ByteSource;
    readonly loaded: LoadedPlan;
    readonly reader: ReturnType<typeof openPlan>;
  },
  idx: number,
): Promise<StepOutcome | null> => {
  const row = context.loaded.docs[idx];
  if (row === undefined) {
    return DONE;
  }
  const { library } = host;
  const skip = (counts: ImportStep["counts"]): StepOutcome | null =>
    passOver(library, job, idx, counts);
  if (row.standing === "held") {
    return skip({ alreadySaved: 1 });
  }
  if (row.standing === "deleted") {
    return landingOutcome(
      library,
      job,
      idx,
      library.land(importActor(job), { answer: CAME_BACK, opId: undefined }, (scope) =>
        restoreDoc(scope, job, row.doc.itemId, idx),
      ),
    );
  }
  if (row.zip.size > NOTE_MAX_BYTES) {
    return skip({ unreadable: 1 });
  }
  let text: string;
  try {
    text = await textOf(context.source, row.zip, ITEM_TEXT_MAX_BYTES);
  } catch (error) {
    if (error instanceof ZipError) {
      return skip({ unreadable: 1 });
    }
    throw error;
  }
  const read = importPlannedDoc(context.reader, row.doc, text, {
    newBlockId: library.ids.block,
    now: host.now(),
  });
  if (!read.ok) {
    return skip({ unreadable: 1 });
  }
  return landingOutcome(
    library,
    job,
    idx,
    library.land(importActor(job), { answer: LANDED, opId: undefined }, (scope) => {
      const result = landDoc(scope, host, read.read);
      advanceImport(scope.storage, job.id, {
        changeSetId: result.held ? undefined : scope.set().id,
        counts: result.held
          ? { alreadySaved: 1 }
          : { added: 1, unreadable: read.read.item.leftOut },
        cursor: idx + 1,
      });
      return result;
    }),
  );
};

const namedFileSchema = z.object({ original_sha: z.string().nullable(), sha256: z.string() });

// what live items name of the plan's files once its notes have landed: the notes it read, those
// the library held already and those back from Deleted alike, none of which it need read for this
const namedFiles = (sql: SqlStatements, jobId: string): ReadFiles => {
  const named = sql
    .all(
      `SELECT DISTINCT item_blobs.sha256, items.original_sha
         FROM item_blobs JOIN items ON items.id = item_blobs.item_id
        WHERE items.deleted_at IS NULL AND items.purged = 0 AND item_blobs.sha256 IN
          (SELECT json_extract(json, '$.sha') FROM import_rows WHERE job_id = ? AND kind = ?)`,
      [jobId, ROWS.file],
    )
    .map((row) => namedFileSchema.parse(row));
  return {
    attached: new Set(named.map((row) => row.sha256)),
    originals: new Set(
      named.flatMap((row) => (row.original_sha === row.sha256 ? [row.sha256] : [])),
    ),
  };
};

// the files no item names, planned once every note has landed, each an item of its own
const planFiles = (scope: LandingScope, host: ImportHost, job: ImportJob, loaded: LoadedPlan) => {
  const sql = scope.storage;
  const items = planFileItems(
    loaded.plan,
    namedFiles(sql, job.id),
    { newItemId: host.library.ids.item },
    host.now(),
  );
  putImportRows(
    sql,
    job.id,
    ROWS.fileItem,
    items.map((value, idx) => ({ idx, value })),
  );
  advanceImport(sql, job.id, {
    cursor: 0,
    phase: "files",
    total: loaded.docs.length + items.length,
  });
};

const landDocs = async (
  host: ImportHost,
  job: ImportJob,
  startedAt: number,
): Promise<StepOutcome> => {
  const source = await r2Source(host.env.BLOBS, blobKey(host.accountId, job.sha));
  if (source === null) {
    return failed(FILE_GONE);
  }
  const loaded = host.library.read((sql) => loadPlan(sql, job.id));
  if (!loaded.ok) {
    return DONE;
  }
  const context = { loaded: loaded.value, reader: openPlan(loaded.value.plan), source };
  const end = Math.min(loaded.value.docs.length, job.cursor + PAGE_DOCS);
  let landedBytes = 0;
  for (let idx = job.cursor; idx < end; idx += 1) {
    const row = loaded.value.docs[idx];
    // what landing the note will read, none for one the library holds or left out for its size
    const size =
      row === undefined || row.standing !== "new" || row.zip.size > NOTE_MAX_BYTES
        ? 0
        : row.zip.size;
    if (landedBytes > 0 && landedBytes + size > LAND_PAGE_BYTES) {
      return MORE;
    }
    landedBytes += size;
    const outcome = await docOutcome(host, job, context, idx);
    if (outcome !== null) {
      return outcome;
    }
    if (host.now() - startedAt > PAGE_MS) {
      return MORE;
    }
  }
  if (end < loaded.value.docs.length) {
    return MORE;
  }
  return apart(host.library, (scope) => {
    planFiles(scope, host, job, loaded.value);
  })
    ? MORE
    : DONE;
};

const LANDED_FILE = z.object({ held: z.boolean() });

const landFiles = (host: ImportHost, job: ImportJob): StepOutcome => {
  const { library } = host;
  const page = library.read((sql) =>
    importRows(
      sql,
      job.id,
      ROWS.fileItem,
      { from: job.cursor, limit: PAGE_FILES },
      fileItemRowSchema,
    ),
  );
  if (!page.ok || page.value.length === 0) {
    return DONE;
  }
  for (const { idx, value } of page.value) {
    const landed = library.land(
      importActor(job),
      { answer: LANDED_FILE, opId: undefined },
      (scope) => {
        const held = runPlan(scope.storage, readItem(value.itemId))?.kind === "live";
        if (!held) {
          landNew(scope, {
            blocks: [],
            fields: {
              ...value.fields,
              deletedAt: null,
              folderId: folderIdOf(scope, host, value.folderPath),
            },
            id: value.itemId,
          });
        }
        advanceImport(scope.storage, job.id, {
          changeSetId: held ? undefined : scope.set().id,
          counts: held ? { alreadySaved: 1 } : { added: 1 },
          cursor: idx + 1,
        });
        return { held };
      },
    );
    const outcome = landingOutcome(library, job, idx, landed);
    if (outcome !== null) {
      return outcome;
    }
  }
  // a page short of a whole one was the last
  return page.value.length < PAGE_FILES ? DONE : MORE;
};

export const stepMarkdown = async (host: ImportHost, job: ImportJob): Promise<StepOutcome> => {
  const startedAt = host.now();
  switch (job.phase) {
    case "reading": {
      return await readPaths(host, job, startedAt);
    }
    case "landing": {
      return await landDocs(host, job, startedAt);
    }
    case "files": {
      return landFiles(host, job);
    }
    // no default
  }
};
