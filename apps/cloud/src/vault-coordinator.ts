import type { VaultManifest } from "@repo/notes/sync/manifest";
import type { DeleteResult, PutResult, VaultChange } from "@repo/notes/sync/sync-port";
import { ABSENT_VERSION, type VaultFile, type VaultPath } from "@repo/notes/sync/vault-file";
import {
  CONTENT_TYPE_OCTET_STREAM,
  CONTENT_TYPE_SSE,
  formatChangeFrame,
  formatVersionHeader,
  HEADER_BASE_VERSION,
  HEADER_CONTENT_HASH,
  HEADER_VERSION,
  parseVersionHeader,
} from "@repo/notes/sync/wire";
import { DurableObject } from "cloudflare:workers";
import { sha256Hex } from "./hash";
import { matchRoute } from "./route";

// ---------------------------------------------------------------------------
// VaultCoordinator — one Durable Object per vault, the source of truth for that
// vault's file set. It owns the MANIFEST in DO SQLite storage (a `files` row per
// path: version + contentHash + size), and
// implements the `SyncPort` semantics over the `@repo/notes/sync/wire` HTTP
// routes. Raw file bytes live in R2 (`VAULT_FILES`, keyed `${vaultId}/${path}`);
// the manifest here is authoritative for versions + hashes.
//
// CONCURRENCY. Every mutation (PUT/DELETE) runs through `runExclusive`, an
// in-memory promise-chain mutex, so at most one mutation is in flight per vault.
// Combined with SQLite's *synchronous* API (the version read + bump commit
// atomically, uninterrupted), this makes the optimistic-concurrency check
// race-free: two puts based on the same version can never both win — the first
// bumps the version, the second sees the new version and gets `version-conflict`.
// The mutex also orders the R2 writes so a slow write can't clobber a newer one.
// (This is a plain mutex, NOT `blockConcurrencyWhile` — reads stay concurrent
// and we never hold a storage gate across R2 I/O.)
//
// WRITE ORDERING (crash-consistency). A PUT writes bytes to R2 *before*
// committing the manifest row; a DELETE removes the manifest row *before*
// deleting the R2 object. Either way the manifest never points at a missing
// blob — the tolerable failure mode is an orphan blob (garbage-collectable),
// never a dangling pointer.
// ---------------------------------------------------------------------------

/** A row of the DO's `files` manifest table. */
type FileRow = {
  readonly path: string;
  readonly version: number;
  readonly content_hash: string;
  readonly size: number;
};

/** sha-256 of zero bytes — the canonical "empty" digest. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Largest PUT body this DO will buffer, in bytes (32 MiB). `handlePut` buffers
 * the whole request in memory before hashing/storing it, and a DO's memory
 * budget is ~128 MB — an unbounded body is a self-DoS/cost hole. Checked both
 * on `Content-Length` (before buffering) and on the buffered length (chunked
 * bodies carry no `Content-Length`).
 */
const MAX_FILE_BYTES = 33_554_432; // 32 MiB

/**
 * The `current` file to report on a PUT `version-conflict` when the path is in
 * fact ABSENT (a rare delete-vs-edit race: the client's base version is > 0 but
 * the file was deleted meanwhile). `SyncPort.PutResult` has no absent-conflict
 * variant, so we encode absence as a `VaultFile` at `ABSENT_VERSION` (0) — the
 * sentinel that already means "no such version yet"; a consumer keys off it.
 */
function absentFile(path: VaultPath): VaultFile {
  return { path, contentHash: EMPTY_SHA256, version: ABSENT_VERSION, size: 0 };
}

function rowToFile(row: FileRow): VaultFile {
  return { path: row.path, contentHash: row.content_hash, version: row.version, size: row.size };
}

export class VaultCoordinator extends DurableObject<Env> {
  /** Open SSE subscribers on the `changes` stream (in-memory; per live instance). */
  private readonly subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly encoder = new TextEncoder();
  /** Serializes mutations (see the CONCURRENCY note above). */
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS files (
           path TEXT PRIMARY KEY,
           version INTEGER NOT NULL,
           content_hash TEXT NOT NULL,
           size INTEGER NOT NULL
         )`,
      );
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = matchRoute(request.method, url.pathname, url.search);
    switch (match.kind) {
      case "manifest":
        return Response.json(this.readManifest(match.vaultId));
      case "getFile":
        return this.handleGet(match.vaultId, match.path);
      case "putFile":
        return this.handlePut(match.vaultId, match.path, request);
      case "deleteFile":
        return this.handleDelete(match.vaultId, match.path, request);
      case "changes":
        return this.handleChanges();
      case "bad-file-path":
        return new Response("missing or malformed ?path", { status: 400 });
      case "unmatched":
        return new Response("not found", { status: 404 });
    }
  }

  // ---- reads (no mutex; concurrent) ----------------------------------------

  private readManifest(vaultId: string): VaultManifest {
    const rows = this.ctx.storage.sql
      .exec<FileRow>("SELECT path, version, content_hash, size FROM files ORDER BY path")
      .toArray();
    return { vaultId, files: rows.map(rowToFile) };
  }

  private readFile(path: VaultPath): VaultFile | null {
    const row = this.ctx.storage.sql
      .exec<FileRow>("SELECT path, version, content_hash, size FROM files WHERE path = ?", path)
      .toArray()[0];
    return row === undefined ? null : rowToFile(row);
  }

  private async handleGet(vaultId: string, path: VaultPath): Promise<Response> {
    const file = this.readFile(path);
    if (file === null) return new Response(null, { status: 404 });
    const object = await this.env.VAULT_FILES.get(objectKey(vaultId, path));
    if (object === null) return new Response(null, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": CONTENT_TYPE_OCTET_STREAM,
        [HEADER_VERSION]: formatVersionHeader(file.version),
        [HEADER_CONTENT_HASH]: file.contentHash,
      },
    });
  }

  // ---- mutations (serialized through the mutex) ----------------------------

  private async handlePut(vaultId: string, path: VaultPath, request: Request): Promise<Response> {
    const base = parseVersionHeader(request.headers.get(HEADER_BASE_VERSION));
    if (base === null) {
      return new Response(`missing or invalid ${HEADER_BASE_VERSION}`, { status: 400 });
    }
    // Reject an oversized body before buffering it, when the client declares one.
    const declaredLength = parseContentLength(request.headers.get("content-length"));
    if (declaredLength !== null && declaredLength > MAX_FILE_BYTES) {
      return new Response("file too large", { status: 413 });
    }
    // Read + hash the body OUTSIDE the mutex (no storage touched yet).
    const bytes = new Uint8Array(await request.arrayBuffer());
    // A chunked body carries no Content-Length — re-check the buffered size.
    if (bytes.length > MAX_FILE_BYTES) {
      return new Response("file too large", { status: 413 });
    }
    const contentHash = await sha256Hex(bytes);

    return this.runExclusive(async () => {
      const current = this.readFile(path);
      const currentVersion = current?.version ?? ABSENT_VERSION;
      if (currentVersion !== base) {
        const result: PutResult = {
          ok: false,
          reason: "version-conflict",
          current: current ?? absentFile(path),
        };
        return Response.json(result); // conflict is a value -> HTTP 200
      }

      const version = currentVersion + 1;
      // Bytes first (durable) so the manifest never points at a missing blob.
      await this.env.VAULT_FILES.put(objectKey(vaultId, path), bytes);
      // Then commit the manifest row (synchronous SQL).
      this.ctx.storage.sql.exec(
        `INSERT INTO files (path, version, content_hash, size) VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           version = excluded.version,
           content_hash = excluded.content_hash,
           size = excluded.size`,
        path,
        version,
        contentHash,
        bytes.length,
      );

      const file: VaultFile = { path, contentHash, version, size: bytes.length };
      this.broadcast({ kind: "upserted", file });
      const result: PutResult = { ok: true, file };
      return Response.json(result);
    });
  }

  private async handleDelete(
    vaultId: string,
    path: VaultPath,
    request: Request,
  ): Promise<Response> {
    const base = parseVersionHeader(request.headers.get(HEADER_BASE_VERSION));
    if (base === null) {
      return new Response(`missing or invalid ${HEADER_BASE_VERSION}`, { status: 400 });
    }
    return this.runExclusive(async () => {
      const current = this.readFile(path);
      if (current === null) {
        const result: DeleteResult = { ok: false, reason: "not-found" };
        return Response.json(result);
      }
      if (current.version !== base) {
        const result: DeleteResult = { ok: false, reason: "version-conflict", current };
        return Response.json(result);
      }

      // Remove the manifest pointer first, then the blob.
      this.ctx.storage.sql.exec("DELETE FROM files WHERE path = ?", path);
      await this.env.VAULT_FILES.delete(objectKey(vaultId, path));

      this.broadcast({ kind: "deleted", path });
      const result: DeleteResult = { ok: true };
      return Response.json(result);
    });
  }

  // ---- SSE change stream ---------------------------------------------------

  private handleChanges(): Response {
    let registered: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        registered = controller;
        this.subscribers.add(controller);
        // A leading comment frame flushes headers + confirms the subscription.
        controller.enqueue(this.encoder.encode(": connected\n\n"));
      },
      cancel: () => {
        if (registered !== null) this.subscribers.delete(registered);
      },
    });
    return new Response(stream, {
      headers: { "content-type": CONTENT_TYPE_SSE, "cache-control": "no-cache" },
    });
  }

  private broadcast(change: VaultChange): void {
    const frame = this.encoder.encode(formatChangeFrame(change));
    for (const controller of this.subscribers) {
      try {
        controller.enqueue(frame);
      } catch {
        this.subscribers.delete(controller); // stream already closed
      }
    }
  }

  // ---- mutation mutex ------------------------------------------------------

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(task);
    // Keep the chain alive regardless of this task's outcome (don't leak the
    // rejection onto the tail — the caller still receives it via `run`).
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function objectKey(vaultId: string, path: VaultPath): string {
  return `${vaultId}/${path}`;
}

/** Parse a `Content-Length` header into a non-negative integer, or `null` when
 * absent/malformed — a missing/bad header just skips the pre-buffer check
 * (the post-buffer size check still catches it). */
function parseContentLength(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
