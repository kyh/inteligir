// The library written out as a zip in the vault's format (`@repo/editor/codec/export-plan`):
// every live item one markdown file in its folder, its highlights' store beside it, every file it
// holds once under `assets/`, the filing rules at the root. The zip lives under the account's own
// prefix in R2, `acct/<userId>/x/<id>.zip`, so the account's deletion takes it, seven days after
// it was written the alarm lets it go, and the device downloads it from `/v1/exports/<id>`
// (`./export-routes`).
//
// The alarm writes it a run at a time, each run bounded by what it reads and writes, never by its
// clock alone, which moves only while it waits on R2: first the plan, a page of items each run
// given its file; then the items, a run's worth of their markdown each; then the files they hold,
// a run's worth of bytes each; then the zip's directory. Every part of the multipart upload but the
// last is one length, as R2 asks, so the bytes past a run's last whole part wait in rows for the
// next run's first; each run ends in one transaction that keeps what it wrote (the plan's rows,
// the entries' records, the parts' etags, those bytes and the cursor), so a run the platform ends
// is written again from there. A run is counted before it starts, so an export whose runs keep
// ending fails, and another can start. A run cut off before its end uploads its parts again
// under the same numbers, which S3's multipart API, which R2 implements, takes as replacing them;
// were one kept instead, the zip's completion fails and the export with it, never a zip of mixed
// runs.

import type { exportJobSchema } from "@repo/contract/cloud/library/library-wire";
import {
  beginExport,
  exportDoc,
  exportFolderPaths,
  exportTarget,
  planExportDoc,
  rulesFile,
} from "@repo/editor/codec/export-plan";
import type { ExportFile } from "@repo/editor/codec/export-plan";
import { wikiFilingKeys, wikiTargetKeys } from "@repo/notes/knowledge/link-resolve";
import { EXPORT_PHASES, EXPORT_STATES } from "@repo/notes/library/library-schema";
import type { SqlRow, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { errorFields } from "../log";
import { partSink } from "../zip/part-sink";
import type { PartSink } from "../zip/part-sink";
import { centralHeader, endRecords, writeZipEntry } from "../zip/zip-write";
import type { ZipFile, ZipRecord } from "../zip/zip-write";
import { blobKey, readBlobRow } from "./cell-blobs";
import {
  docRowSchema,
  dropExportRows,
  filedSchema,
  json,
  placedSchema,
  putRows,
  readTail,
  recordSchema,
  rowCount,
  ROWS,
  rowsFrom,
  rowsUnder,
  rowValue,
  runStore,
  writeTail,
} from "./cell-export-rows";
import type { DocRow, ExportRow, Look, RunStore } from "./cell-export-rows";
import { liveFolders } from "./cell-folders";
import { apart, PAGE_MS } from "./cell-import-host";
import type { ImportHost } from "./cell-import-host";
import { readLibraryRules } from "./cell-import-markdown";
import type { CellIds } from "./cell-ids";
import { dropJob, dueJobs, retryJob, scheduleJob } from "./cell-jobs";
import type { DueJob } from "./cell-jobs";
import type { LandingScope } from "./cell-landing";
import { logJobFailure } from "./cell-library";
import { refuse } from "./cell-refusal";
import { readItemNow } from "./change-sets";

// how long an export waits to be downloaded
export const EXPORT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

// the zip of one export, under the account's prefix
export const exportKey = (accountId: string, id: string): string => `acct/${accountId}/x/${id}.zip`;

const MiB = 1024 * 1024;

// what one run of an export may do
export interface ExportLimits {
  // the length of every part but the last; R2 takes such parts at one length of at least 5 MiB,
  // and 8 MiB parts reach its 10,000 parts at 80 GB, far past what one library holds
  readonly partBytes: number;
  // the items one run of the plan gives their files
  readonly planItems: number;
  // the markdown one run writes, at least one item's: writing an item costs about 1.7 s of CPU a
  // MiB of its markdown (measured in node on the build's runner), and the alarm's 30 s of CPU
  // also runs an import's page
  readonly textBytes: number;
  // the zip's bytes one run writes, at least one file's
  readonly zipBytes: number;
}

export const EXPORT_LIMITS: ExportLimits = {
  partBytes: 8 * MiB,
  planItems: 1000,
  textBytes: 2 * MiB,
  zipBytes: 128 * MiB,
};

// runs that end without moving the export on, the platform's cut-offs among them, before it fails
const ATTEMPTS_MAX = 3;

const FAILED = "The export couldn't be written. Try exporting again.";

type ExportState = (typeof EXPORT_STATES)[number];
type ExportPhase = (typeof EXPORT_PHASES)[number];

export interface ExportJob {
  readonly id: string;
  readonly state: ExportState;
  readonly bytes: number | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly expiresAt: number | null;
  readonly message: string | null;
}

const rowSchema = z.object({
  bytes: z.number().nullable(),
  expires_at: z.number().nullable(),
  finished_at: z.number().nullable(),
  id: z.string(),
  message: z.string().nullable(),
  started_at: z.number(),
  state: z.enum(EXPORT_STATES),
});

const COLUMNS = "id, state, bytes, started_at, finished_at, expires_at, message";

const jobOf = (raw: SqlRow): ExportJob => {
  const row = rowSchema.parse(raw);
  return {
    bytes: row.bytes,
    expiresAt: row.expires_at,
    finishedAt: row.finished_at,
    id: row.id,
    message: row.message,
    startedAt: row.started_at,
    state: row.state,
  };
};

export const exportJobView = (job: ExportJob): z.input<typeof exportJobSchema> => ({
  bytes: job.bytes,
  expiresAt: job.expiresAt,
  finishedAt: job.finishedAt,
  id: job.id,
  message: job.message,
  startedAt: job.startedAt,
  state: job.state,
});

export const readExportJob = (sql: SqlStatements, id: string): ExportJob | null => {
  const [raw] = sql.all(`SELECT ${COLUMNS} FROM export_jobs WHERE id = ?`, [id]);
  return raw === undefined ? null : jobOf(raw);
};

const payloadSchema = z.object({ exportId: z.string() });

const writeJob = (id: string) =>
  ({ id: `export:${id}`, kind: "export", payload: JSON.stringify({ exportId: id }) }) as const;

const expireJob = (id: string) =>
  ({ id: `expire:${id}`, kind: "expire", payload: JSON.stringify({ exportId: id }) }) as const;

// an export of the library as it is now, its first run at once; one already being written
// answers for this ask too
export const startExport = (scope: LandingScope, ids: CellIds): ExportJob => {
  const sql = scope.storage;
  const [writing] = sql.all(
    `SELECT ${COLUMNS} FROM export_jobs WHERE state = 'writing' ORDER BY started_at DESC LIMIT 1`,
    [],
  );
  if (writing !== undefined) {
    return jobOf(writing);
  }
  const id = ids.item();
  sql.run(
    `INSERT INTO export_jobs (id, state, phase, cursor, upload_id, part_bytes, written, parts,
       entries, bytes, started_at, finished_at, expires_at, message)
     VALUES (?, 'writing', 'plan', 0, NULL, NULL, 0, 0, 0, NULL, ?, NULL, NULL, NULL)`,
    [id, scope.now],
  );
  scheduleJob(sql, writeJob(id), scope.now);
  return readExportJob(sql, id) ?? refuse({ kind: "not-found" });
};

// ---- where a writing export stands ----

interface Writing {
  readonly id: string;
  readonly phase: ExportPhase;
  // the plan's last item rid; the item, held file or record the next run writes
  readonly cursor: number;
  readonly uploadId: string | null;
  readonly partBytes: number | null;
  // the zip's bytes so far, its whole parts uploaded and its entries written
  readonly written: number;
  readonly parts: number;
  readonly entries: number;
  readonly startedAt: number;
}

const writingSchema = z.object({
  cursor: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
  id: z.string(),
  part_bytes: z.number().int().positive().nullable(),
  parts: z.number().int().nonnegative(),
  phase: z.enum(EXPORT_PHASES),
  started_at: z.number(),
  state: z.enum(EXPORT_STATES),
  upload_id: z.string().nullable(),
  written: z.number().int().nonnegative(),
});

const readWriting = (sql: SqlStatements, id: string): Writing | null => {
  const [raw] = sql.all(
    `SELECT id, state, phase, cursor, upload_id, part_bytes, written, parts, entries, started_at
     FROM export_jobs WHERE id = ?`,
    [id],
  );
  if (raw === undefined) {
    return null;
  }
  const row = writingSchema.parse(raw);
  return row.state === "writing"
    ? {
        cursor: row.cursor,
        entries: row.entries,
        id: row.id,
        partBytes: row.part_bytes,
        parts: row.parts,
        phase: row.phase,
        startedAt: row.started_at,
        uploadId: row.upload_id,
        written: row.written,
      }
    : null;
};

// ---- the plan's runs ----

const headSchema = z.object({
  aliases: z.string(),
  folder_id: z.string().nullable(),
  id: z.string(),
  rid: z.number().int(),
  title: z.string(),
});

const aliasesSchema = z.array(z.string());

// a page of the live items given their files, the first page with the rules' name and the
// folders' paths; the last moves the export on to its items
const planPage = (sql: SqlStatements, job: Writing, limits: ExportLimits): Writing => {
  const store = runStore(job.id, (work) => work(sql));
  if (job.cursor === 0) {
    beginExport(store);
    putRows(
      sql,
      job.id,
      ROWS.folder,
      [...exportFolderPaths(liveFolders(sql))].map(([key, path]) => ({ idx: 0, key, value: path })),
    );
  }
  const heads = sql
    .all(
      `SELECT rid, id, title, folder_id, aliases FROM items
       WHERE purged = 0 AND deleted_at IS NULL AND rid > ? ORDER BY rid LIMIT ?`,
      [job.cursor, limits.planItems],
    )
    .map((raw) => headSchema.parse(raw));
  const from = rowCount(sql, job.id, ROWS.doc);
  for (const [index, head] of heads.entries()) {
    const aliases = aliasesSchema.parse(JSON.parse(head.aliases));
    const dir =
      head.folder_id === null ? "" : (rowValue(sql, job.id, ROWS.folder, head.folder_id) ?? "");
    const planned = planExportDoc(
      { aliases, folderId: head.folder_id, id: head.id, title: head.title },
      dir,
      store,
    );
    const idx = from + index;
    const doc: DocRow = { aliases, name: planned.name, path: planned.path };
    putRows(sql, job.id, ROWS.doc, [{ idx, key: head.id, value: JSON.stringify(doc) }]);
    const filed = JSON.stringify({ aliases, path: planned.path });
    putRows(
      sql,
      job.id,
      ROWS.filing,
      wikiFilingKeys(planned.path, aliases).map((key) => ({ idx, key, value: filed })),
    );
  }
  store.keep(sql);
  const last = heads.at(-1);
  return heads.length < limits.planItems || last === undefined
    ? { ...job, cursor: 0, phase: "docs" }
    : { ...job, cursor: last.rid };
};

// ---- the zip's runs ----

// bytes that already arrive compressed, which deflate only slows
const COMPRESSED =
  /^(?:image\/(?:jpeg|png|gif|webp|avif|heic)|video\/|audio\/|application\/(?:pdf|zip))/u;

const encoder = new TextEncoder();

const readOrStop =
  (host: ImportHost): Look =>
  (work) => {
    const read = host.library.read(work);
    if (!read.ok) {
      throw new Error(`the library refused the export's read: ${read.refusal.kind}`);
    }
    return read.value;
  };

const zipFileOf = (host: ImportHost, look: Look, file: ExportFile, modified: Date): ZipFile => {
  if (file.kind === "text") {
    return {
      deflate: true,
      modified,
      open: async () => await Promise.resolve(new Blob([encoder.encode(file.text)]).stream()),
      path: file.path,
    };
  }
  const mime = look((sql) => readBlobRow(sql, file.sha)?.mime ?? null);
  return {
    deflate: mime === null || !COMPRESSED.test(mime),
    modified,
    open: async () => {
      const object = await host.env.BLOBS.get(blobKey(host.accountId, file.sha));
      if (object === null) {
        throw new Error(`the library's file ${file.sha} is not in R2`);
      }
      return object.body;
    },
    path: file.path,
  };
};

// the link an item is written by: its file's shortest spelling that resolves back to it among
// every file filed under a key that spelling tries, which answers as the whole plan does
const targetOf = (look: Look, exportId: string) => {
  const known = new Map<string, string | null>();
  return (itemId: string): string | null => {
    const held = known.get(itemId);
    if (held !== undefined) {
      return held;
    }
    const target = look((sql) => {
      const row = rowValue(sql, exportId, ROWS.doc, itemId);
      if (row === null) {
        return null;
      }
      const { path } = json(docRowSchema, row);
      const filed = new Map(
        wikiTargetKeys(path)
          .flatMap((key) => rowsUnder(sql, exportId, ROWS.filing, key))
          .map((value) => json(filedSchema, value))
          .map((candidate) => [candidate.path, candidate] as const),
      );
      return exportTarget(path, [...filed.values()]);
    });
    known.set(itemId, target);
    return target;
  };
};

// where the zip's runs stand: the phase and the next row of it to write
interface Position {
  readonly phase: ExportPhase;
  readonly cursor: number;
}

// the next item or held file to write from where the run stands, null past the phase's last
const nextRow = (look: Look, exportId: string, at: Position): ExportRow | null =>
  look((sql) =>
    rowsFrom(sql, exportId, at.phase === "docs" ? ROWS.doc : ROWS.placed, at.cursor, 1),
  )[0] ?? null;

interface RunWritten {
  readonly job: Writing;
  readonly records: readonly ZipRecord[];
  readonly store: RunStore;
  readonly sink: PartSink;
}

// a run of the items, then of the files they hold, until a run's worth is written; where it
// stopped, which its end keeps
const writeEntries = async (
  host: ImportHost,
  job: Writing,
  context: { readonly sink: PartSink; readonly limits: ExportLimits },
): Promise<RunWritten> => {
  const { limits, sink } = context;
  const look = readOrStop(host);
  const store = runStore(job.id, look);
  const modified = new Date(job.startedAt);
  const records: ZipRecord[] = [];
  const startedAt = host.now();
  const startedOffset = sink.offset();
  let text = 0;
  const write = async (file: ExportFile): Promise<void> => {
    const record = await writeZipEntry(
      zipFileOf(host, look, file, modified),
      sink.offset(),
      sink.write,
    );
    records.push(record);
    if (file.kind === "text") {
      text += record.size;
    }
  };
  const spent = (): boolean =>
    text >= limits.textBytes ||
    sink.offset() - startedOffset >= limits.zipBytes ||
    host.now() - startedAt > PAGE_MS;
  const ports = {
    mediaType: (sha: string) => look((sql) => readBlobRow(sql, sha)?.mime ?? null),
    store,
    target: targetOf(look, job.id),
  };
  if (job.phase === "docs" && job.cursor === 0 && job.entries === 0) {
    const rules = look(readLibraryRules);
    if (rules !== null) {
      await write(rulesFile(rules));
    }
  }
  const writeRow = async (phase: "docs" | "files", row: ExportRow): Promise<void> => {
    if (phase === "files") {
      await write({ kind: "bytes", ...json(placedSchema, row.value) });
      return;
    }
    const now = look((sql) => readItemNow(sql, row.key));
    if (now === null || now.state.fields.deletedAt !== null) {
      return;
    }
    const item = {
      annotations: now.annotations,
      blocks: now.state.blocks,
      fields: now.state.fields,
      id: row.key,
    };
    for (const file of exportDoc(item, json(docRowSchema, row.value), ports)) {
      await write(file);
    }
  };
  // a phase's end ends the run too, so the files the items placed are on disk for the next
  let at: Position = { cursor: job.cursor, phase: job.phase };
  while ((at.phase === "docs" || at.phase === "files") && !spent()) {
    const row = nextRow(look, job.id, at);
    if (row === null) {
      at = at.phase === "docs" ? { cursor: 0, phase: "files" } : { cursor: 0, phase: "directory" };
      break;
    }
    await writeRow(at.phase, row);
    at = { cursor: row.idx + 1, phase: at.phase };
  }
  return { job: { ...job, ...at }, records, sink, store };
};

// a run's end, in one transaction: what it planned and wrote kept, the bytes past its last part
// held for the next run, and that run asked for at once
const keepRun = (host: ImportHost, ran: RunWritten): void => {
  const { job, records, sink, store } = ran;
  apart(host.library, (scope) => {
    const sql = scope.storage;
    store.keep(sql);
    const from = rowCount(sql, job.id, ROWS.record);
    putRows(
      sql,
      job.id,
      ROWS.record,
      records.map((record, index) => ({
        idx: from + index,
        key: "",
        value: JSON.stringify(record),
      })),
    );
    putRows(
      sql,
      job.id,
      ROWS.part,
      sink.uploaded.map((part) => ({ idx: part.partNumber, key: "", value: part.etag })),
    );
    sql.run(
      `UPDATE export_jobs SET phase = ?, cursor = ?, written = ?, parts = ?, entries = ?
       WHERE id = ?`,
      [
        job.phase,
        job.cursor,
        sink.offset(),
        job.parts + sink.uploaded.length,
        job.entries + records.length,
        job.id,
      ],
    );
    writeTail(sql, job.id, sink.tail());
    scheduleJob(sql, writeJob(job.id), scope.now);
  });
};

const ZIP_TYPE = { httpMetadata: { contentType: "application/zip" } };

// the export's multipart upload, begun by its first run of the zip, which keeps its id at once
const uploadOf = async (
  host: ImportHost,
  job: Writing,
  limits: ExportLimits,
): Promise<{ readonly upload: R2MultipartUpload; readonly partBytes: number }> => {
  const key = exportKey(host.accountId, job.id);
  if (job.uploadId !== null && job.partBytes !== null) {
    return {
      partBytes: job.partBytes,
      upload: host.env.BLOBS.resumeMultipartUpload(key, job.uploadId),
    };
  }
  const upload = await host.env.BLOBS.createMultipartUpload(key, ZIP_TYPE);
  apart(host.library, (scope) => {
    scope.storage.run("UPDATE export_jobs SET upload_id = ?, part_bytes = ? WHERE id = ?", [
      upload.uploadId,
      limits.partBytes,
      job.id,
    ]);
  });
  return { partBytes: limits.partBytes, upload };
};

const exportIdOf = (job: DueJob): string => payloadSchema.parse(JSON.parse(job.payload)).exportId;

// the export ended, ready or failed, and what its runs kept let go
const endExport = (
  host: ImportHost,
  id: string,
  ended: {
    readonly state: ExportState;
    readonly bytes: number | null;
    readonly message: string | null;
  },
): void => {
  apart(host.library, (scope) => {
    const expiresAt = ended.state === "ready" ? scope.now + EXPORT_KEEP_MS : null;
    scope.storage.run(
      `UPDATE export_jobs SET state = ?, bytes = ?, message = ?, finished_at = ?, expires_at = ?
       WHERE id = ?`,
      [ended.state, ended.bytes, ended.message, scope.now, expiresAt, id],
    );
    dropExportRows(scope.storage, id);
    dropJob(scope.storage, writeJob(id).id);
    if (expiresAt !== null) {
      scheduleJob(scope.storage, expireJob(id), expiresAt);
    }
  });
};

const RECORDS_PAGE = 1000;

// the zip's last run: its directory from the records, its end records, its last part, and the
// upload completed; a zip a run cut off after completing it is ready as it stands
const closeZip = async (host: ImportHost, job: Writing, limits: ExportLimits): Promise<void> => {
  const look = readOrStop(host);
  const key = exportKey(host.accountId, job.id);
  const done = await host.env.BLOBS.head(key);
  if (done !== null) {
    endExport(host, job.id, { bytes: done.size, message: null, state: "ready" });
    return;
  }
  const { partBytes, upload } = await uploadOf(host, job, limits);
  const tail = look((sql) => readTail(sql, job.id));
  const sink = partSink(upload, partBytes, { parts: job.parts, tail, written: job.written });
  const directoryAt = sink.offset();
  for (let from = 0; ; from += RECORDS_PAGE) {
    const page = look((sql) => rowsFrom(sql, job.id, ROWS.record, from, RECORDS_PAGE));
    for (const row of page) {
      await sink.write(centralHeader(json(recordSchema, row.value)));
    }
    if (page.length < RECORDS_PAGE) {
      break;
    }
  }
  await sink.write(endRecords(job.entries, sink.offset() - directoryAt, directoryAt));
  const kept = look((sql) => rowsFrom(sql, job.id, ROWS.part, 0, job.parts)).map(
    (row): R2UploadedPart => ({ etag: row.value, partNumber: row.idx }),
  );
  const last = await upload.uploadPart(job.parts + sink.uploaded.length + 1, sink.tail());
  await upload.complete([...kept, ...sink.uploaded, last]);
  endExport(host, job.id, { bytes: sink.offset(), message: null, state: "ready" });
};

// one run of a writing export, by where it stands
const runExport = async (host: ImportHost, job: Writing, limits: ExportLimits): Promise<void> => {
  switch (job.phase) {
    case "plan": {
      apart(host.library, (scope) => {
        const next = planPage(scope.storage, job, limits);
        scope.storage.run("UPDATE export_jobs SET phase = ?, cursor = ? WHERE id = ?", [
          next.phase,
          next.cursor,
          job.id,
        ]);
        scheduleJob(scope.storage, writeJob(job.id), scope.now);
      });
      break;
    }
    case "docs":
    case "files": {
      const { partBytes, upload } = await uploadOf(host, job, limits);
      const tail = readOrStop(host)((sql) => readTail(sql, job.id));
      const sink = partSink(upload, partBytes, {
        parts: job.parts,
        tail,
        written: job.written,
      });
      keepRun(host, await writeEntries(host, job, { limits, sink }));
      break;
    }
    case "directory": {
      await closeZip(host, job, limits);
      break;
    }
    // no default
  }
};

// an export whose runs kept ending: its upload let go, and the export said failed
const failExport = async (host: ImportHost, job: Writing): Promise<void> => {
  if (job.uploadId !== null) {
    try {
      await host.env.BLOBS.resumeMultipartUpload(
        exportKey(host.accountId, job.id),
        job.uploadId,
      ).abort();
    } catch (error) {
      // R2 aborts an upload left incomplete on its own, seven days on
      console.warn({ event: "export-abort-failed", ...errorFields(error) });
    }
  }
  endExport(host, job.id, { bytes: null, message: FAILED, state: "failed" });
};

const writeExport = async (host: ImportHost, due: DueJob, limits: ExportLimits): Promise<void> => {
  const id = exportIdOf(due);
  const read = host.library.read((sql) => readWriting(sql, id));
  const job = read.ok ? read.value : null;
  if (job === null) {
    apart(host.library, (scope) => {
      dropJob(scope.storage, due.id);
    });
    return;
  }
  if (due.attempts >= ATTEMPTS_MAX) {
    await failExport(host, job);
    return;
  }
  // counted before the run, so a run the platform ends counts too
  apart(host.library, (scope) => {
    retryJob(scope.storage, due, scope.now);
  });
  await host.durable();
  try {
    await runExport(host, job, limits);
  } catch (error) {
    logJobFailure(due, error);
  }
};

// an export past its seven days: its zip leaves R2, and the job says it went
const expireExport = async (host: ImportHost, job: DueJob): Promise<void> => {
  const id = exportIdOf(job);
  try {
    await host.env.BLOBS.delete(exportKey(host.accountId, id));
  } catch (error) {
    logJobFailure(job, error);
    apart(host.library, (scope) => {
      retryJob(scope.storage, job, scope.now);
    });
    return;
  }
  apart(host.library, (scope) => {
    scope.storage.run("UPDATE export_jobs SET state = 'expired' WHERE id = ? AND state = 'ready'", [
      id,
    ]);
    dropJob(scope.storage, job.id);
  });
};

export const runExports = async (
  host: ImportHost,
  limits: ExportLimits = EXPORT_LIMITS,
): Promise<void> => {
  const due = host.library.read((sql) => dueJobs(sql, host.now(), ["export", "expire"]));
  if (!due.ok) {
    return;
  }
  for (const job of due.value) {
    await (job.kind === "export" ? writeExport(host, job, limits) : expireExport(host, job));
  }
};
