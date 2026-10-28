// A zip of markdown read into the library: a vault this app exported, one Obsidian keeps, or any
// folder of notes, by the codec's two-pass plan (`@repo/editor/codec/import-plan`). The first runs
// walk the zip's directory, keeping each note's frontmatter, each highlights' store and the
// filing rules, and putting every file in the library under its sha; then the plan is made once,
// every note's item and id minted and kept, an address or an id the library holds already standing
// for its item. Later runs land a page of notes at a time, each read whole against the plan, and
// last every file no note embedded becomes an item of its own. Every run reads the zip where it
// lies in R2, a range at a time.

import { BLOB_MAX_BYTES } from "@repo/contract/cloud/library/library-blobs";
import { assetMediaType } from "@repo/contract/cloud/vault/vault-schema";
import {
  importPathKind,
  importPlannedDoc,
  openPlan,
  planFileItems,
  planImport,
} from "@repo/editor/codec/import-plan";
import type { ImportEntry, ImportPlan, PlannedDoc } from "@repo/editor/codec/import-plan";
import { urlKey } from "@repo/notes/items/item-url";
import { libraryItemFieldsSchema } from "@repo/notes/library/library-item";
import { readItem, readMeta, writeMeta } from "@repo/notes/library/library-queries";
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
  importActor,
  keepFile,
  LIBRARY_FULL,
  MORE,
  PAGE_MS,
} from "./cell-import-host";
import type { ImportHost, StepOutcome } from "./cell-import-host";
import { advanceImport, dropImportRows, importRows, putImportRows } from "./cell-import-jobs";
import type { ImportJob } from "./cell-import-jobs";
import { landNew, storeAdds } from "./cell-items";
import { ITEM_TEXT_MAX_BYTES, urlHolder } from "./cell-landing";
import type { LandingScope } from "./cell-landing";
import type { CellStorage } from "./cell-storage";

// the filing rules an import brings, which the built-in agent reads; an import never replaces the
// library's own
const LIBRARY_RULES_META = "library_rules";
const RULES_MAX_BYTES = 256 * 1024;

const rulesSchema = z.string().nullable();

// the filing rules the library keeps, null while it keeps none
export const readLibraryRules = (sql: SqlStatements): string | null =>
  rulesSchema.parse(runPlan(sql, readMeta(LIBRARY_RULES_META)));

// a file read whole to hash it; a larger one is read twice, once to hash it and once to store it
const BUFFERED_MAX_BYTES = 8 * 1024 * 1024;
// the notes, and the files made items, one run lands
const PAGE_DOCS = 50;
const PAGE_FILES = 100;
// every row of a kind, read at once
const ALL = { from: 0, limit: 1_000_000 } as const;

const NOT_A_ZIP =
  "This file isn't a zip of notes. Choose a .zip of a folder of Markdown files, or of an Obsidian vault.";
const FILE_GONE = "The file to import is no longer in the library. Choose it again.";

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
  z.object({ kind: z.literal("rules"), path: z.string(), text: z.string() }),
  z.object({ kind: z.literal("store"), path: z.string(), text: z.string() }),
  z.object({ kind: z.literal("file"), path: z.string(), sha: z.string() }),
]);
type Entry = z.infer<typeof entrySchema>;

const plannedDocSchema = z.object({
  aliases: z.array(z.string()),
  fileId: z.string().nullable(),
  folderId: z.string().nullable(),
  itemId: z.string(),
  path: z.string(),
  title: z.string(),
  urlKey: z.string().nullable(),
});

const docRowSchema = z.object({
  doc: plannedDocSchema,
  // an item the library holds already stands for the note: its address or its id is the library's
  held: z.boolean(),
  zip: zipEntrySchema,
});

const folderRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  path: z.string(),
});

const fileRowSchema = z.object({
  kind: z.enum(["image", "pdf", "video", "audio", "file"]),
  path: z.string(),
  sha: z.string(),
});

const storeRowSchema = z.object({ key: z.string(), text: z.string() });

// what a landed note read of the files: the ones it embeds or links, and its own original
const usedRowSchema = z.object({ attached: z.array(z.string()), original: z.string().nullable() });

const fileItemRowSchema = z.object({
  fields: libraryItemFieldsSchema.omit({ deletedAt: true, folderId: true }),
  folderPath: z.string().nullable(),
  itemId: z.string(),
});

const ROWS = {
  doc: "doc",
  entry: "entry",
  file: "file",
  fileItem: "file-item",
  folder: "folder",
  store: "store",
  used: "used",
} as const;

const decoder = new TextDecoder();

const hex = (digest: ArrayBuffer): string =>
  [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// a folder's path of the zip as the library's: each name cut to what a folder holds
const libraryPath = (path: string): string =>
  path
    .split("/")
    .map((name) => name.trim().slice(0, 255))
    .join("/");

const folderIdOf = (scope: LandingScope, host: ImportHost, path: string | null): string | null =>
  path === null || path === ""
    ? null
    : (folderOfTarget(scope, { path: libraryPath(path) }, host.library.ids.item) ?? null);

// ---- the first runs: the zip's paths ----

type EntryRead =
  | { readonly kind: "row"; readonly value: Entry }
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
  const mime = assetMediaType(entry.path) ?? "application/octet-stream";
  let file: Parameters<typeof keepFile>[1];
  if (entry.size <= BUFFERED_MAX_BYTES) {
    const bytes = await readZipEntry(source, entry, BUFFERED_MAX_BYTES);
    const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
    file = { body: async () => await Promise.resolve(bytes), mime, sha, size: bytes.byteLength };
  } else {
    const digest = new crypto.DigestStream("SHA-256");
    const hashed = await openZipEntry(source, entry);
    await hashed.pipeTo(digest);
    const sha = hex(await digest.digest);
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
      const front = text.slice(0, frontmatterEnd(text) ?? 0);
      return { kind: "row", value: { kind, path: entry.path, text: front, zip: entry } };
    }
    case "rules":
    case "store": {
      return {
        kind: "row",
        value: { kind, path: entry.path, text: await textOf(source, entry, ITEM_TEXT_MAX_BYTES) },
      };
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
  row: undefined,
  skipped: { skipped: 1 },
  unreadable: { unreadable: 1 },
} as const;

const importEntryOf = (entry: Entry): ImportEntry =>
  entry.kind === "file"
    ? { kind: "file", path: entry.path, sha: entry.sha }
    : { kind: entry.kind, path: entry.path, text: entry.text };

// a note as the plan lands it: one whose id or address a live item holds is that item, and one
// whose id a purged item kept takes a fresh id, since the library never reuses one
interface SettledDoc {
  readonly doc: PlannedDoc;
  readonly held: boolean;
}

const settledDoc = (sql: CellStorage, doc: PlannedDoc, newId: () => string): SettledDoc => {
  const item = runPlan(sql, readItem(doc.itemId));
  if (item?.kind === "live") {
    return { doc, held: true };
  }
  const holder = doc.urlKey === null ? null : urlHolder(sql, doc.urlKey, null);
  if (holder !== null) {
    return { doc: { ...doc, itemId: holder.id }, held: true };
  }
  return { doc: item === null ? doc : { ...doc, itemId: newId() }, held: false };
};

const writePlan = (scope: LandingScope, host: ImportHost, job: ImportJob): void => {
  const sql = scope.storage;
  const entries = importRows(sql, job.id, ROWS.entry, ALL, entrySchema).map((row) => row.value);
  const zips = new Map(
    entries.flatMap((entry) => (entry.kind === "doc" ? [[entry.path, entry.zip] as const] : [])),
  );
  const plan = planImport(entries.map(importEntryOf), {
    newFolderId: host.library.ids.item,
    newItemId: host.library.ids.item,
  });
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
    ROWS.folder,
    plan.folders.map((value, idx) => ({ idx, value })),
  );
  putImportRows(
    sql,
    job.id,
    ROWS.file,
    plan.files.map((value, idx) => ({ idx, value })),
  );
  putImportRows(
    sql,
    job.id,
    ROWS.store,
    plan.stores.map((value, idx) => ({ idx, value })),
  );
  if (
    plan.rules !== null &&
    plan.rules.length <= RULES_MAX_BYTES &&
    readLibraryRules(sql) === null
  ) {
    runPlan(sql, writeMeta(LIBRARY_RULES_META, plan.rules));
  }
  dropImportRows(sql, job.id, ROWS.entry);
  advanceImport(sql, job.id, { cursor: 0, phase: "landing", total: plan.docs.length });
};

const readPaths = async (
  host: ImportHost,
  job: ImportJob,
  startedAt: number,
): Promise<StepOutcome> => {
  const source = await r2Source(host.env.BLOBS, blobKey(host.accountId, job.sha));
  if (source === null) {
    return failed(FILE_GONE);
  }
  let entries: ZipEntry[];
  try {
    entries = await readZipEntries(source);
  } catch (error) {
    if (error instanceof ZipError) {
      return failed(NOT_A_ZIP);
    }
    throw error;
  }
  for (const entry of entries.filter((listed) => listed.index >= job.cursor)) {
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

// ---- the plan's runs: the notes, then the files no note embedded ----

interface LoadedPlan {
  readonly plan: ImportPlan;
  readonly docs: readonly z.infer<typeof docRowSchema>[];
  readonly folderPaths: ReadonlyMap<string, string>;
}

const loadPlan = (sql: SqlStatements, jobId: string): LoadedPlan => {
  const docs = importRows(sql, jobId, ROWS.doc, ALL, docRowSchema).map((row) => row.value);
  const folders = importRows(sql, jobId, ROWS.folder, ALL, folderRowSchema).map((row) => row.value);
  return {
    docs,
    folderPaths: new Map(folders.map((folder) => [folder.id, folder.path])),
    plan: {
      docs: docs.map((row) => row.doc),
      files: importRows(sql, jobId, ROWS.file, ALL, fileRowSchema).map((row) => row.value),
      folders,
      rules: null,
      stores: importRows(sql, jobId, ROWS.store, ALL, storeRowSchema).map((row) => row.value),
    },
  };
};

const LANDED = z.object({ held: z.boolean(), highlights: z.number() });

const landDoc = (
  scope: LandingScope,
  host: ImportHost,
  job: ImportJob,
  read: Extract<ReturnType<typeof importPlannedDoc>, { ok: true }>["read"],
  folderPath: string | null,
): z.input<typeof LANDED> => {
  const { item, doc } = read;
  const key = item.fields.url === null ? null : urlKey(item.fields.url);
  if (
    runPlan(scope.storage, readItem(doc.itemId))?.kind === "live" ||
    (key !== null && urlHolder(scope.storage, key, null) !== null)
  ) {
    return { held: true, highlights: 0 };
  }
  const annotations = storeAdds(item.annotations);
  const landed = landNew(scope, importActor(job), {
    annotations,
    blocks: item.blocks,
    fields: { ...item.fields, deletedAt: null, folderId: folderIdOf(scope, host, folderPath) },
    id: doc.itemId,
  });
  askFill(scope, landed);
  return { held: false, highlights: annotations.filter((op) => op.parentId === null).length };
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
  const skip = (counts: Parameters<typeof advanceImport>[2]["counts"]): StepOutcome | null =>
    apart(library, (scope) => {
      advanceImport(scope.storage, job.id, { counts, cursor: idx + 1 });
    })
      ? null
      : DONE;
  if (row.held) {
    return skip({ alreadySaved: 1 });
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
    newAnnotationId: library.ids.annotation,
    newBlockId: library.ids.block,
    now: host.now(),
  });
  if (!read.ok) {
    return skip({ unreadable: 1 });
  }
  const folderPath =
    row.doc.folderId === null ? null : (context.loaded.folderPaths.get(row.doc.folderId) ?? null);
  const landed = library.land(importActor(job), { answer: LANDED, opId: undefined }, (scope) => {
    const result = landDoc(scope, host, job, read.read, folderPath);
    putImportRows(scope.storage, job.id, ROWS.used, [
      {
        idx,
        value: { attached: [...read.read.files], original: read.read.item.fields.originalSha },
      },
    ]);
    advanceImport(scope.storage, job.id, {
      changeSetId: result.held ? undefined : scope.set().id,
      counts: result.held ? { alreadySaved: 1 } : { added: 1, highlights: result.highlights },
      cursor: idx + 1,
    });
    return result;
  });
  if (landed.ok) {
    return null;
  }
  if (landed.refusal.kind === "gone") {
    return DONE;
  }
  return landed.refusal.kind === "quota" ? failed(LIBRARY_FULL) : skip({ unreadable: 1 });
};

// the files no note embedded, planned once every note has landed, each an item of its own
const planFiles = (scope: LandingScope, host: ImportHost, job: ImportJob, loaded: LoadedPlan) => {
  const sql = scope.storage;
  const used = importRows(sql, job.id, ROWS.used, ALL, usedRowSchema).map((row) => row.value);
  const items = planFileItems(
    loaded.plan,
    {
      attached: new Set(used.flatMap((row) => row.attached)),
      originals: new Set(used.flatMap((row) => (row.original === null ? [] : [row.original]))),
    },
    { newFolderId: host.library.ids.item, newItemId: host.library.ids.item },
    host.now(),
  );
  const paths = new Map([
    ...loaded.folderPaths,
    ...items.folders.map((folder) => [folder.id, folder.path] as const),
  ]);
  putImportRows(
    sql,
    job.id,
    ROWS.fileItem,
    items.items.map((item, idx) => ({
      idx,
      value: {
        fields: item.fields,
        folderPath: item.folderId === null ? null : (paths.get(item.folderId) ?? null),
        itemId: item.itemId,
      },
    })),
  );
  dropImportRows(sql, job.id, ROWS.used);
  advanceImport(sql, job.id, {
    cursor: 0,
    phase: "files",
    total: loaded.docs.length + items.items.length,
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
  for (let idx = job.cursor; idx < end; idx += 1) {
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
          landNew(scope, importActor(job), {
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
    if (!landed.ok) {
      if (landed.refusal.kind === "gone") {
        return DONE;
      }
      if (landed.refusal.kind === "quota") {
        return failed(LIBRARY_FULL);
      }
      apart(library, (scope) => {
        advanceImport(scope.storage, job.id, { counts: { unreadable: 1 }, cursor: idx + 1 });
      });
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
