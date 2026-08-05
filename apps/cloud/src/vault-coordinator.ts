import type { VaultManifest } from "@repo/notes/sync/manifest";
import type { DeleteResult, PutResult, VaultChange } from "@repo/notes/sync/sync-port";
import { ABSENT_VERSION, type VaultFile, type VaultPath } from "@repo/notes/sync/vault-file";
import {
  base64UrlDecode,
  CONTENT_TYPE_OCTET_STREAM,
  CONTENT_TYPE_SSE,
  formatChangeFrame,
  formatVersionHeader,
  isValidVaultId,
  HEADER_BASE_VERSION,
  HEADER_CONTENT_HASH,
  HEADER_VERSION,
  parseVersionHeader,
  type DeviceListResponse,
  type DeviceRecord,
  type EnrollOfferResponse,
  type EnrollResponse,
  type RevokeResponse,
} from "@repo/notes/sync/wire";
import { DurableObject } from "cloudflare:workers";
import {
  keyFoundsVault,
  readDeviceAssertion,
  unauthorized,
  verifyDeviceAssertion,
  type VerifiedDevice,
} from "./device-assertion";
import {
  parseEnrollOfferRequest,
  parseEnrollRequest,
  parseRevokeRequest,
  readJsonBody,
} from "./device-body";
import { sha256Hex } from "./hash";
import { logUnhandled } from "./log";
import { matchRoute } from "./route";

// ---------------------------------------------------------------------------
// VaultCoordinator — one Durable Object per vault, the source of truth for that
// vault's file set (addressed `env.VaultCoordinator.getByName(vaultId)`). It
// owns the MANIFEST in DO SQLite storage (a `files` row per path: version +
// contentHash + size), and implements the `SyncPort` semantics over the
// `@repo/notes/sync/wire` HTTP routes. Raw file bytes live in R2
// (`VAULT_FILES`, keyed `${vaultId}/${path}`); the manifest here is
// authoritative for versions + hashes.
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
//
// MEMBERSHIP. This DO is also the authority on WHO may touch the vault: the
// `devices` roster lives here, beside the manifest, because it is the only
// component that can answer membership without an extra hop. Credential
// VERIFICATION still happens in the Worker slot (`device-assertion.ts`, run
// again here over the same raw header — never a forwarded verdict); the DO adds
// only the question about its own state. Founding is arithmetic: an empty
// roster admits exactly the key whose SHA-256 reproduces this DO's own name.
//
// A vault with an empty roster is a PRE-DEVICE vault, still authorized by the
// Better Auth session the Worker checked. The first device to found it takes
// that door away — once a roster exists, a session-only request is 403.
// ---------------------------------------------------------------------------

/** A row of the DO's `files` manifest table. */
type FileRow = {
  readonly path: string;
  readonly version: number;
  readonly content_hash: string;
  readonly size: number;
};

/** A row of the `devices` roster. `revoked_at` non-null is a tombstone. */
type DeviceRow = {
  readonly public_key: string;
  readonly name: string;
  readonly enrolled_at: number;
  readonly revoked_at: number | null;
};

/** Longest offer TTL the coordinator honours; a longer `notAfter` is clamped down. */
const MAX_OFFER_TTL_SECONDS = 600;

/** Enrollment attempts allowed per `ENROLL_WINDOW_SECONDS`, per live DO instance. */
const MAX_ENROLL_ATTEMPTS = 10;
const ENROLL_WINDOW_SECONDS = 60;

/** The roster name a founding device gets; it never sends one on a sync request. */
const FOUNDER_DEVICE_NAME = "Founding device";

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
  /** Enrollment attempt budget. Per-vault and single-threaded, so no shared store. */
  private enrollAttempts = 0;
  private enrollWindowStart = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS files (
           path TEXT PRIMARY KEY,
           version INTEGER NOT NULL,
           content_hash TEXT NOT NULL,
           size INTEGER NOT NULL
         )`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS devices (
           public_key TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           enrolled_at INTEGER NOT NULL,
           revoked_at INTEGER
         )`,
      );
      // The server holds sha256hex(secret), never the secret — redeeming proves
      // knowledge of a preimage it could not have learned from us.
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS enroll_offers (
           enroll_id TEXT PRIMARY KEY,
           not_after INTEGER NOT NULL,
           consumed_at INTEGER
         )`,
      );
    });
  }

  override async fetch(request: Request): Promise<Response> {
    // Same contract as the Worker entry (src/log.ts): every expected failure
    // here is a value (a 4xx, or an `{ok:false}` conflict at 200), so a throw is
    // a bug or a storage outage — log it once, structured, and answer 500. An
    // unwrapped throw would surface to the client as the Worker's own opaque
    // 500 with no log line naming the DO.
    try {
      return await this.route(request);
    } catch (error) {
      logUnhandled("vault-coordinator", request, error);
      return new Response("internal error", { status: 500 });
    }
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = matchRoute(request.method, url.pathname, url.search);
    if (match.kind === "unmatched") return new Response("not found", { status: 404 });
    if (match.kind === "bad-file-path") {
      return new Response("missing or malformed ?path", { status: 400 });
    }

    // The ONE unauthenticated route: the offer secret is the auth, and the
    // caller is by definition not yet a device.
    if (match.kind === "enroll") return this.handleEnroll(request);

    const refusal = await this.authorize(request);
    if (refusal !== null) return refusal;

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
      case "enrollOffer":
        return this.handleEnrollOffer(request);
      case "devices":
        return this.handleDevices();
      case "revoke":
        return this.handleRevoke(request);
    }
  }

  // ---- membership ----------------------------------------------------------

  /**
   * Refuse the request, or `null` to let it through. Re-parses the raw
   * `Authorization` header rather than trusting anything the Worker concluded,
   * and binds the assertion to THIS object's name rather than to the path the
   * request happens to carry.
   */
  private async authorize(request: Request): Promise<Response | null> {
    const assertion = readDeviceAssertion(request.headers);
    if (assertion === null) {
      // No device credential. The Worker authorized this some other way (a
      // Better Auth session), which is legal only until this vault has a roster.
      return this.deviceCount() === 0 ? null : forbidden("device-credential-required");
    }
    const vaultId = this.ctx.id.name;
    if (vaultId === undefined) return forbidden("unaddressable-vault");

    const verdict = await verifyDeviceAssertion(assertion, vaultId, nowSeconds());
    if (!verdict.ok) return unauthorized(verdict.reason);
    return this.admit(verdict.device, vaultId);
  }

  /** Roster check, with founding as its empty case. `null` = admitted. */
  private async admit(device: VerifiedDevice, vaultId: string): Promise<Response | null> {
    const existing = this.readDevice(device.publicKey);
    if (existing !== null) {
      return existing.revoked_at === null ? null : forbidden("device-revoked");
    }
    // ONE refusal for both misses. Answering "not-founder" on an empty roster
    // and "device-not-enrolled" on a populated one turns any key holder into a
    // prober of whether a given vaultId has been founded yet.
    if (this.deviceCount() > 0 || !(await keyFoundsVault(device.publicKeyBytes, vaultId))) {
      return forbidden("device-not-enrolled");
    }

    // `OR IGNORE`: two founding requests can race here (this path is outside the
    // mutation mutex), and they carry the same key, so the loser is a no-op.
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO devices (public_key, name, enrolled_at, revoked_at) VALUES (?, ?, ?, NULL)",
      device.publicKey,
      FOUNDER_DEVICE_NAME,
      nowSeconds(),
    );
    return null;
  }

  private deviceCount(): number {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM devices")
      .toArray()[0];
    return row?.n ?? 0;
  }

  /** Devices that can still authenticate — tombstones excluded. */
  private liveDeviceCount(): number {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL")
      .toArray()[0];
    return row?.n ?? 0;
  }

  private readDevice(publicKey: string): DeviceRow | null {
    const row = this.ctx.storage.sql
      .exec<DeviceRow>(
        "SELECT public_key, name, enrolled_at, revoked_at FROM devices WHERE public_key = ?",
        publicKey,
      )
      .toArray()[0];
    return row ?? null;
  }

  // ---- device identity routes ----------------------------------------------

  private async handleEnrollOffer(request: Request): Promise<Response> {
    const body = parseEnrollOfferRequest(await readJsonBody(request));
    if (body === null) return new Response("malformed enroll-offer body", { status: 400 });

    const now = nowSeconds();
    // Clamp rather than trust: the offer's window is the coordinator's policy.
    const notAfter = Math.min(body.notAfter, now + MAX_OFFER_TTL_SECONDS);
    if (notAfter <= now) return new Response("offer already expired", { status: 400 });

    return this.runExclusive(async () => {
      this.ctx.storage.sql.exec("DELETE FROM enroll_offers WHERE not_after <= ?", now);
      this.ctx.storage.sql.exec(
        `INSERT INTO enroll_offers (enroll_id, not_after, consumed_at) VALUES (?, ?, NULL)
         ON CONFLICT(enroll_id) DO UPDATE SET not_after = excluded.not_after`,
        body.enrollId,
        notAfter,
      );
      const result: EnrollOfferResponse = { notAfter };
      return Response.json(result);
    });
  }

  /**
   * Redeem an offer. Every offer-related failure — wrong secret, expired,
   * already consumed, over the attempt budget — answers with the SAME
   * `{ok:false}` at 200, so this route is not an offer-existence oracle. Only a
   * malformed body is distinguishable, and a body's shape is not a secret.
   */
  private async handleEnroll(request: Request): Promise<Response> {
    // The Worker gates this too. Re-checking here keeps the DO's independence
    // total on the ONE route that arrives with no credential: enrollment is a
    // device-model concept, so a pre-device vault must not offer it a door.
    const vaultId = this.ctx.id.name;
    if (vaultId === undefined || !isValidVaultId(vaultId)) {
      return forbidden("not-a-device-vault");
    }

    const body = parseEnrollRequest(await readJsonBody(request));
    if (body === null) return new Response("malformed enroll body", { status: 400 });

    const now = nowSeconds();
    if (this.enrollThrottled(now)) return Response.json(ENROLL_REFUSED);

    const secret = base64UrlDecode(body.s);
    if (secret === null) return Response.json(ENROLL_REFUSED);
    const enrollId = await sha256Hex(secret);

    return this.runExclusive(async () => {
      const offer = this.ctx.storage.sql
        .exec<{ enroll_id: string }>(
          "SELECT enroll_id FROM enroll_offers WHERE enroll_id = ? AND consumed_at IS NULL AND not_after > ?",
          enrollId,
          now,
        )
        .toArray()[0];
      if (offer === undefined) return Response.json(ENROLL_REFUSED);

      this.ctx.storage.sql.exec(
        "UPDATE enroll_offers SET consumed_at = ? WHERE enroll_id = ?",
        now,
        enrollId,
      );
      // `OR IGNORE` keeps a tombstone a tombstone: a replayed offer naming a
      // revoked key must not resurrect it.
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO devices (public_key, name, enrolled_at, revoked_at) VALUES (?, ?, ?, NULL)",
        body.publicKey,
        body.deviceName,
        now,
      );
      const enrolled = this.readDevice(body.publicKey);
      const result: EnrollResponse = { ok: enrolled !== null && enrolled.revoked_at === null };
      return Response.json(result);
    });
  }

  private handleDevices(): Response {
    const rows = this.ctx.storage.sql
      .exec<DeviceRow>(
        "SELECT public_key, name, enrolled_at, revoked_at FROM devices ORDER BY enrolled_at, public_key",
      )
      .toArray();
    const result: DeviceListResponse = { devices: rows.map(rowToDevice) };
    return Response.json(result);
  }

  private async handleRevoke(request: Request): Promise<Response> {
    const body = parseRevokeRequest(await readJsonBody(request));
    if (body === null) return new Response("malformed revoke body", { status: 400 });

    return this.runExclusive(async () => {
      const existing = this.readDevice(body.publicKey);
      if (existing === null) {
        const missing: RevokeResponse = { ok: false, reason: "not-found" };
        return Response.json(missing);
      }
      // Refuse the one revoke nothing can undo: with no live device left, the
      // vault can neither authenticate nor enroll (an offer needs an enrolled
      // signer), so its DO and its R2 prefix are stranded for good. Leaving is
      // a client-side "disconnect", not a tombstone.
      if (existing.revoked_at === null && this.liveDeviceCount() <= 1) {
        const last: RevokeResponse = { ok: false, reason: "last-device" };
        return Response.json(last);
      }
      const revokedAt = existing.revoked_at ?? nowSeconds();
      if (existing.revoked_at === null) {
        this.ctx.storage.sql.exec(
          "UPDATE devices SET revoked_at = ? WHERE public_key = ?",
          revokedAt,
          body.publicKey,
        );
        // A revoke closes the live socket, not just future auths. We cannot tell
        // which stream belongs to the revoked key, so every subscriber is closed
        // and the honest ones reconnect — re-authenticating on the way back in.
        this.closeSubscribers();
      }
      const result: RevokeResponse = { ok: true, revokedAt };
      return Response.json(result);
    });
  }

  /** Consume one enrollment attempt; true once the window's budget is spent. */
  private enrollThrottled(now: number): boolean {
    if (now - this.enrollWindowStart >= ENROLL_WINDOW_SECONDS) {
      this.enrollWindowStart = now;
      this.enrollAttempts = 0;
    }
    this.enrollAttempts += 1;
    return this.enrollAttempts > MAX_ENROLL_ATTEMPTS;
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
      // Hand R2 the digest we already computed: R2 verifies it server-side and
      // rejects the put on a mismatch, so a corrupted transfer can never be
      // committed under a hash that doesn't describe it. It also lands in the
      // object's own checksums, which is what a future integrity sweep reads.
      await this.env.VAULT_FILES.put(objectKey(vaultId, path), bytes, { sha256: contentHash });
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

  /** End every open `changes` stream. Honest subscribers reconnect and re-auth. */
  private closeSubscribers(): void {
    for (const controller of this.subscribers) {
      try {
        controller.close();
      } catch {
        // Already closed by the peer — nothing to end.
      }
    }
    this.subscribers.clear();
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

/** The one answer every failed redemption gets — see `handleEnroll`. */
const ENROLL_REFUSED: EnrollResponse = { ok: false };

function rowToDevice(row: DeviceRow): DeviceRecord {
  return {
    publicKey: row.public_key,
    name: row.name,
    enrolledAt: row.enrolled_at,
    revokedAt: row.revoked_at,
  };
}

/** A membership refusal. The reason is diagnostic text, never a capability. */
function forbidden(reason: string): Response {
  return new Response(reason, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Parse a `Content-Length` header into a non-negative integer, or `null` when
 * absent/malformed — a missing/bad header just skips the pre-buffer check
 * (the post-buffer size check still catches it). */
function parseContentLength(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
