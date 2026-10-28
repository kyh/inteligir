// The library written out as a zip in the vault's format (`@repo/editor/codec/export-plan`):
// every live item one markdown file in its folder, its highlights' store beside it, every file it
// holds once under `assets/`, the filing rules at the root. The cell writes it in one alarm run,
// each item read only when its turn comes and the zip streamed to R2 in parts of one size (R2
// takes every part but the last at one length), so the cell holds one item and one part at a
// time; the zip lives under the account's own prefix in R2, `acct/<userId>/x/<id>.zip`, so the
// account's deletion takes it, and seven days after it was written the alarm lets it go. The
// device downloads it from `/v1/exports/<id>` (`./export-routes`).

import type { exportJobSchema } from "@repo/contract/cloud/library/library-wire";
import { planExport } from "@repo/editor/codec/export-plan";
import type { ExportFile, ExportItemHead } from "@repo/editor/codec/export-plan";
import type { ExportItem } from "@repo/editor/codec/item-markdown";
import { EXPORT_STATES } from "@repo/notes/library/library-schema";
import { readItem } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlRow, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { zipBytes } from "../zip/zip-write";
import type { ZipFile } from "../zip/zip-write";
import { blobKey, readBlobRow } from "./cell-blobs";
import { liveFolders } from "./cell-folders";
import { apart } from "./cell-import-host";
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

// every part but the last is this long; 8 MiB parts reach R2's 10,000 parts at 80 GB, far past
// what one library holds
const PART_BYTES = 8 * 1024 * 1024;

// a write that throws is tried again, later each time, and the export fails after this many
const ATTEMPTS_MAX = 3;

const FAILED = "The export couldn't be written. Try exporting again.";

type ExportState = (typeof EXPORT_STATES)[number];

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

// an export of the library as it is now, written by the alarm at once; one already being written
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
    `INSERT INTO export_jobs (id, state, bytes, started_at, finished_at, expires_at, message)
     VALUES (?, 'writing', NULL, ?, NULL, NULL, NULL)`,
    [id, scope.now],
  );
  scheduleJob(sql, writeJob(id), scope.now);
  return readExportJob(sql, id) ?? refuse({ kind: "not-found" });
};

// ---- the zip ----

// bytes that already arrive compressed, which deflate only slows
const COMPRESSED =
  /^(?:image\/(?:jpeg|png|gif|webp|avif|heic)|video\/|audio\/|application\/(?:pdf|zip))/u;

const ITEM_IDS = z.object({ id: z.string() });

// the live items, each as the plan names its file; a deleted one stays in the library
const itemHeads = (sql: SqlStatements): ExportItemHead[] =>
  sql
    .all("SELECT id FROM items WHERE purged = 0 AND deleted_at IS NULL ORDER BY rid", [])
    .flatMap((raw) => {
      const item = runPlan(sql, readItem(ITEM_IDS.parse(raw).id));
      return item?.kind === "live" ? [{ fields: item.fields, id: item.id }] : [];
    });

const encoder = new TextEncoder();

const zipFileOf = (host: ImportHost, file: ExportFile, modified: Date): ZipFile => {
  if (file.kind === "text") {
    return {
      deflate: true,
      modified,
      open: async () => await Promise.resolve(new Blob([encoder.encode(file.text)]).stream()),
      path: file.path,
    };
  }
  const mime = host.library.read((sql) => readBlobRow(sql, file.sha)?.mime ?? null);
  return {
    deflate: !(mime.ok && mime.value !== null && COMPRESSED.test(mime.value)),
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

const libraryFiles = function* libraryFiles(host: ImportHost): Generator<ZipFile, void, undefined> {
  const { library } = host;
  const heads = library.read((sql) => ({
    folders: liveFolders(sql),
    items: itemHeads(sql),
    rules: readLibraryRules(sql),
  }));
  if (!heads.ok) {
    return;
  }
  const modified = new Date(host.now());
  const files = planExport({
    folders: heads.value.folders,
    items: heads.value.items,
    mediaType: (sha) => {
      const row = library.read((sql) => readBlobRow(sql, sha));
      return row.ok ? (row.value?.mime ?? null) : null;
    },
    read: (head): ExportItem | null => {
      const now = library.read((sql) => readItemNow(sql, head.id));
      return now.ok && now.value !== null
        ? {
            annotations: now.value.annotations,
            blocks: now.value.state.blocks,
            fields: now.value.state.fields,
            id: head.id,
          }
        : null;
    },
    rules: heads.value.rules,
  });
  for (const file of files) {
    yield zipFileOf(host, file, modified);
  }
};

const joined = (chunks: readonly Uint8Array[], length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
};

// the zip streamed into one multipart upload, a part each time a part's length has arrived
const writeZip = async (host: ImportHost, key: string): Promise<number> => {
  const upload = await host.env.BLOBS.createMultipartUpload(key, {
    httpMetadata: { contentType: "application/zip" },
  });
  const parts: R2UploadedPart[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let total = 0;
  try {
    for await (const chunk of zipBytes(libraryFiles(host))) {
      total += chunk.length;
      pending.push(chunk);
      pendingBytes += chunk.length;
      while (pendingBytes >= PART_BYTES) {
        const bytes = joined(pending, pendingBytes);
        parts.push(await upload.uploadPart(parts.length + 1, bytes.subarray(0, PART_BYTES)));
        const rest = bytes.subarray(PART_BYTES);
        pending = rest.length === 0 ? [] : [rest];
        pendingBytes = rest.length;
      }
    }
    if (pendingBytes > 0 || parts.length === 0) {
      parts.push(await upload.uploadPart(parts.length + 1, joined(pending, pendingBytes)));
    }
    await upload.complete(parts);
  } catch (error) {
    await upload.abort();
    throw error;
  }
  return total;
};

const exportIdOf = (job: DueJob): string => payloadSchema.parse(JSON.parse(job.payload)).exportId;

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
    dropJob(scope.storage, writeJob(id).id);
    if (expiresAt !== null) {
      scheduleJob(scope.storage, expireJob(id), expiresAt);
    }
  });
};

const writeExport = async (host: ImportHost, job: DueJob): Promise<void> => {
  const id = exportIdOf(job);
  try {
    const bytes = await writeZip(host, exportKey(host.accountId, id));
    endExport(host, id, { bytes, message: null, state: "ready" });
  } catch (error) {
    logJobFailure(job, error);
    if (job.attempts + 1 >= ATTEMPTS_MAX) {
      endExport(host, id, { bytes: null, message: FAILED, state: "failed" });
      return;
    }
    apart(host.library, (scope) => {
      retryJob(scope.storage, job, scope.now);
    });
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

export const runExports = async (host: ImportHost): Promise<void> => {
  const due = host.library.read((sql) => dueJobs(sql, host.now(), ["export", "expire"]));
  if (!due.ok) {
    return;
  }
  for (const job of due.value) {
    await (job.kind === "export" ? writeExport(host, job) : expireExport(host, job));
  }
};
