// ---------------------------------------------------------------------------
// HttpSyncPort — a SyncPort implementation over the wire.ts HTTP contract. It
// calls the coordinator's routes with `fetch` and PARSES every response at the
// boundary into the @repo/core result ADTs: a version conflict is a typed value
// carried in an HTTP-200 body (never a thrown exception), and only genuine
// transport failures (a non-200 that isn't a documented conflict/404, a
// malformed envelope, a missing header) become thrown errors.
//
// Universal: `fetch`/`Response`/`ReadableStream`/`TextDecoder`/`AbortController`
// are all Web-standard globals present in node, the browser, React Native, and a
// Cloudflare Worker — so this client lives in @repo/core and every platform
// reuses it. Nothing here is platform-specific; the class stays a pure
// translation of `wire.ts` ↔ `SyncPort`. `fetch` is injectable so tests drive it
// against `new Response(...)` fakes without a real Worker.
// ---------------------------------------------------------------------------

import { isValidHash, type VaultFile, type VaultPath } from "./vault-file";
import type { VaultManifest } from "./manifest";
import type {
  DeleteResult,
  GetResult,
  PutResult,
  SyncPort,
  Unsubscribe,
  VaultChange,
} from "./sync-port";
import {
  CONTENT_TYPE_OCTET_STREAM,
  CONTENT_TYPE_SSE,
  HEADER_AUTHORIZATION,
  HEADER_BASE_VERSION,
  HEADER_CONTENT_HASH,
  HEADER_VERSION,
  changesPath,
  filePath,
  formatBearer,
  formatVersionHeader,
  manifestPath,
  parseVersionHeader,
} from "./wire";
import { isRecord } from "./guards";

/** The `fetch` surface HttpSyncPort needs — the global by default, a fake in tests. */
export type FetchFn = typeof fetch;

export type HttpSyncPortOptions = {
  /** Coordinator origin, e.g. `https://sync.inteligir.app` (no trailing slash needed). */
  baseUrl: string;
  /** The vault this client syncs — scopes every route. */
  vaultId: string;
  /** Bearer token sent as `Authorization: Bearer <token>` on every request. */
  token: string;
  /** Injected `fetch` (tests). Defaults to the global `fetch`. */
  fetchImpl?: FetchFn;
};

/** A `SyncPort` backed by the wire.ts HTTP routes. */
export class HttpSyncPort implements SyncPort {
  private readonly baseUrl: string;
  private readonly vaultId: string;
  private readonly token: string;
  private readonly fetchImpl: FetchFn;

  constructor(opts: HttpSyncPortOptions) {
    // Trim a trailing slash so `baseUrl + "/v1/..."` never doubles up.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.vaultId = opts.vaultId;
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async listManifest(): Promise<VaultManifest> {
    const res = await this.fetchImpl(this.url(manifestPath(this.vaultId)), {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw transportError("manifest", res.status);
    const raw: unknown = await res.json();
    const manifest = parseManifest(raw);
    if (!manifest) throw new Error("sync: coordinator returned a malformed manifest");
    return manifest;
  }

  async getFile(path: VaultPath): Promise<GetResult> {
    const res = await this.fetchImpl(this.url(filePath(this.vaultId, path)), {
      method: "GET",
      headers: this.headers(),
    });
    if (res.status === 404) return { ok: false, reason: "not-found" };
    if (!res.ok) throw transportError("getFile", res.status);
    const version = parseVersionHeader(res.headers.get(HEADER_VERSION));
    const contentHash = res.headers.get(HEADER_CONTENT_HASH);
    if (version === null || contentHash === null || !isValidHash(contentHash)) {
      throw new Error("sync: getFile response missing/invalid version or content-hash headers");
    }
    const content = new Uint8Array(await res.arrayBuffer());
    return { ok: true, file: { path, contentHash, version, size: content.length }, content };
  }

  async putFile(
    path: VaultPath,
    content: Uint8Array,
    expectedBaseVersion: number,
  ): Promise<PutResult> {
    const res = await this.fetchImpl(this.url(filePath(this.vaultId, path)), {
      method: "PUT",
      headers: this.headers({
        [HEADER_BASE_VERSION]: formatVersionHeader(expectedBaseVersion),
        "content-type": CONTENT_TYPE_OCTET_STREAM,
      }),
      // Copy into a fresh (non-shared) Uint8Array so the type is `<ArrayBuffer>`,
      // which `BodyInit` requires — the SyncPort's plain `Uint8Array` may be
      // backed by a SharedArrayBuffer and won't satisfy it. Bodies are file-
      // sized (small), and the copy avoids a banned `as` cast.
      body: new Uint8Array(content),
    });
    // A conflict rides HTTP 200 as an `ok: false` envelope — only a genuine
    // transport failure (401, 5xx, …) is an error.
    if (!res.ok) throw transportError("putFile", res.status);
    const raw: unknown = await res.json();
    const parsed = parsePutResult(raw);
    if (!parsed) throw new Error("sync: putFile returned a malformed envelope");
    return parsed;
  }

  async deleteFile(path: VaultPath, expectedBaseVersion: number): Promise<DeleteResult> {
    const res = await this.fetchImpl(this.url(filePath(this.vaultId, path)), {
      method: "DELETE",
      headers: this.headers({ [HEADER_BASE_VERSION]: formatVersionHeader(expectedBaseVersion) }),
    });
    if (!res.ok) throw transportError("deleteFile", res.status);
    const raw: unknown = await res.json();
    const parsed = parseDeleteResult(raw);
    if (!parsed) throw new Error("sync: deleteFile returned a malformed envelope");
    return parsed;
  }

  subscribe(onChange: (change: VaultChange) => void): Unsubscribe {
    const controller = new AbortController();
    void this.streamChanges(onChange, controller.signal);
    return () => controller.abort();
  }

  // ---- internals ----------------------------------------------------------

  private url(routePath: string): string {
    return `${this.baseUrl}${routePath}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { [HEADER_AUTHORIZATION]: formatBearer(this.token), ...extra };
  }

  /** Read the SSE `changes` stream frame-by-frame, decoding each `VaultChange`.
   * Best-effort: an abort (unsubscribe) or a network drop ends the loop quietly;
   * the caller re-subscribes on the next connect. */
  private async streamChanges(
    onChange: (change: VaultChange) => void,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const res = await this.fetchImpl(this.url(changesPath(this.vaultId)), {
        method: "GET",
        headers: this.headers({ accept: CONTENT_TYPE_SSE }),
        signal,
      });
      if (!res.ok || res.body === null) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const change = parseSseFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (change) onChange(change);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Aborted or dropped — nothing to recover here.
    }
  }
}

/** Factory mirroring the repo's other capability constructors. */
export function createHttpSyncPort(opts: HttpSyncPortOptions): HttpSyncPort {
  return new HttpSyncPort(opts);
}

// ---- boundary parsers (never trust the wire) ------------------------------

function transportError(route: string, status: number): Error {
  return new Error(`sync: ${route} failed with HTTP ${status}`);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseVaultFile(raw: unknown): VaultFile | null {
  if (!isRecord(raw)) return null;
  const { path, contentHash, version, size } = raw;
  if (typeof path !== "string" || path === "") return null;
  if (typeof contentHash !== "string" || !isValidHash(contentHash)) return null;
  if (!isNonNegativeInt(version) || !isNonNegativeInt(size)) return null;
  return { path, contentHash, version, size };
}

function parseManifest(raw: unknown): VaultManifest | null {
  if (!isRecord(raw)) return null;
  const { vaultId, generation, files } = raw;
  if (typeof vaultId !== "string" || !isNonNegativeInt(generation) || !Array.isArray(files)) {
    return null;
  }
  const parsed: VaultFile[] = [];
  for (const entry of files) {
    const file = parseVaultFile(entry);
    if (!file) return null;
    parsed.push(file);
  }
  return { vaultId, generation, files: parsed };
}

function parsePutResult(raw: unknown): PutResult | null {
  if (!isRecord(raw)) return null;
  if (raw.ok === true) {
    const file = parseVaultFile(raw.file);
    return file ? { ok: true, file } : null;
  }
  if (raw.ok === false && raw.reason === "version-conflict") {
    const current = parseVaultFile(raw.current);
    return current ? { ok: false, reason: "version-conflict", current } : null;
  }
  return null;
}

function parseDeleteResult(raw: unknown): DeleteResult | null {
  if (!isRecord(raw)) return null;
  if (raw.ok === true) return { ok: true };
  if (raw.ok === false && raw.reason === "not-found") return { ok: false, reason: "not-found" };
  if (raw.ok === false && raw.reason === "version-conflict") {
    const current = parseVaultFile(raw.current);
    return current ? { ok: false, reason: "version-conflict", current } : null;
  }
  return null;
}

/** Decode one SSE frame's `data:` payload into a `VaultChange`, or null if the
 * frame carries no valid change (comment/keepalive, or a malformed body). */
function parseSseFrame(frame: string): VaultChange | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  return parseVaultChange(raw);
}

function parseVaultChange(raw: unknown): VaultChange | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "upserted") {
    const file = parseVaultFile(raw.file);
    return file ? { kind: "upserted", file } : null;
  }
  if (raw.kind === "deleted" && typeof raw.path === "string" && raw.path !== "") {
    return { kind: "deleted", path: raw.path };
  }
  return null;
}
