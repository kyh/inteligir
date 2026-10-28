// `/v1/blobs/<sha>`: the library's files, read and written through the R2 binding behind the
// Worker's own credential check (https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
// A PUT asks the account's cell for room at the length it declares, streams the body into R2,
// which refuses bytes that do not hash to the sha, and has the cell settle the file's row at the
// size R2 holds. A GET or HEAD hands the request's own headers to R2, which answers the range and
// the preconditions they name; the Worker spells the status, a stranger's page copy is served
// under a script-less sandbox, and every other file under a sandbox too, but a PDF, whose viewer
// a sandbox blanks.

import { BLOB_MAX_BYTES, V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { SHA256_HEX_RE } from "@repo/notes/library/library-item";
import { z } from "zod";

import { isBelowFloor } from "../client-floor";
import { declaredLength } from "../cloud-http";
import { createDb } from "../db/client";
import { errorFields } from "../log";
import { spendDeviceBudget } from "../rate-limit";
import { holderIdOf, lazyPrincipal } from "../wire/v1-principal";
import { blobKey } from "./cell-blobs";
import type { CellRefusal } from "./cell-refusal";
import { libraryCell } from "./library-cell";

const BLOB_PATH = /^\/v1\/blobs\/(?<sha>[^/]+)$/u;

export const isBlobPath = (pathname: string): boolean => pathname.startsWith(`${V1_BLOBS_PATH}/`);

const text = (status: number, message: string, headers: HeadersInit = {}): Response =>
  new Response(message, {
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
    status,
  });

// ---- what a file is served under ----

// a sandbox blanks WebKit's PDF viewer, so a PDF alone is served without one: its policy still runs
// no script and loads nothing but itself, and only this origin may frame it
const PDF_POLICY =
  "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";
// a kept copy of a page is a stranger's page: the sandbox runs none of its script and gives it no
// origin, it loads only what it carries inline, and a link it holds, followed, names nothing here
const PAGE_COPY_POLICY =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";
// any other file: an <img> never runs an svg's script, but a navigation to its url would
const SANDBOX_POLICY = "default-src 'none'; sandbox";

const serveUnder = (headers: Headers, contentType: string | undefined): void => {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "application/pdf") {
    headers.set("content-security-policy", PDF_POLICY);
    return;
  }
  if (type === "text/html") {
    headers.set("content-security-policy", PAGE_COPY_POLICY);
    headers.set("referrer-policy", "no-referrer");
    return;
  }
  headers.set("content-security-policy", SANDBOX_POLICY);
};

// ---- reads ----

// a file never changes under its sha, so a device keeps it as long as it likes, and no shared
// cache keeps it at all
const READ_HEADERS = {
  "accept-ranges": "bytes",
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
};

// a media loader sends the etag it holds with every range it reads, and a 304 to a range leaves it
// holding only its probe's bytes, so a ranged read is answered its range whatever it revalidates
const conditionsOf = (request: Request): Headers => {
  const conditions = new Headers(request.headers);
  if (request.headers.has("range")) {
    conditions.delete("if-none-match");
    conditions.delete("if-modified-since");
  }
  return conditions;
};

// a precondition R2 found false: a match the request required is 412, a copy it already holds 304
const preconditionFailed = (request: Request, headers: Headers): Response =>
  request.headers.has("if-match") || request.headers.has("if-unmodified-since")
    ? new Response(null, { headers, status: 412 })
    : new Response(null, { headers, status: 304 });

const SINGLE_RANGE = /^bytes=(?<first>\d*)-(?<last>\d*)$/u;

interface SingleRange {
  readonly first: string;
  readonly last: string;
}

// the one range a request asks for, or null for a multi-part ask or none: R2 answers one
// satisfiable range and the whole file for any other ask, and a multi-part one is answered whole,
// as a server may
const singleRangeOf = (request: Request): SingleRange | null => {
  const groups = SINGLE_RANGE.exec(
    (request.headers.get("range") ?? "").replaceAll(" ", ""),
  )?.groups;
  const first = groups?.["first"] ?? "";
  const last = groups?.["last"] ?? "";
  return groups === undefined || (first === "" && last === "") ? null : { first, last };
};

// a single range that names no byte of the file (RFC 9110 § 14.1.2)
const unsatisfiable = ({ first, last }: SingleRange, size: number): boolean =>
  first === "" ? last === "0" : Number(first) >= size;

// the range R2 answered, which the runtime spells as an offset and a length (a suffix asked for
// comes back as both, its `suffix` null), or the suffix alone where it keeps the ask's own form
const servedRangeSchema = z.union([
  z.object({ length: z.number().int().nonnegative(), offset: z.number().int().nonnegative() }),
  z.object({ suffix: z.number().int().nonnegative() }),
]);

// a range that spans the whole file is still the range asked for, which a media loader plays only
// once it is answered 206; null when R2 answered no range, having ignored the ask
const servedRange = (object: R2Object): { readonly start: number; readonly end: number } | null => {
  const range = servedRangeSchema.safeParse(object.range);
  if (!range.success) {
    return null;
  }
  const { data } = range;
  const start = "suffix" in data ? object.size - data.suffix : data.offset;
  const length = "suffix" in data ? data.suffix : data.length;
  return { end: start + length - 1, start };
};

const readBlob = async (request: Request, bucket: R2Bucket, key: string): Promise<Response> => {
  const object = await bucket.get(key, { onlyIf: conditionsOf(request), range: request.headers });
  if (object === null) {
    return text(404, "That file isn't in the library.");
  }
  const headers = new Headers(READ_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  serveUnder(headers, object.httpMetadata?.contentType);
  if (!("body" in object)) {
    return preconditionFailed(request, headers);
  }
  const single = singleRangeOf(request);
  if (single !== null && unsatisfiable(single, object.size)) {
    await object.body.cancel();
    headers.set("content-range", `bytes */${String(object.size)}`);
    return new Response(null, { headers, status: 416 });
  }
  const served = single === null ? null : servedRange(object);
  const body = request.method === "HEAD" ? null : object.body;
  if (body === null) {
    await object.body.cancel();
  }
  if (served === null) {
    headers.set("content-length", String(object.size));
    return new Response(body, { headers, status: 200 });
  }
  headers.set("content-length", String(served.end - served.start + 1));
  headers.set(
    "content-range",
    `bytes ${String(served.start)}-${String(served.end)}/${String(object.size)}`,
  );
  return new Response(body, { headers, status: 206 });
};

// ---- writes ----

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

// the type a file was sent as, without its parameters, or bytes of no known type
const mediaTypeOf = (header: string | null): string => {
  const type = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return MEDIA_TYPE.test(type) ? type : "application/octet-stream";
};

const refusalAnswer = (refusal: Pick<CellRefusal, "kind">): Response => {
  switch (refusal.kind) {
    case "gone": {
      return text(410, "This account was deleted.");
    }
    case "quota": {
      return text(507, "Your library is full.");
    }
    case "not-found":
    case "conflict":
    case "too-large":
    case "blob-missing":
    case "url-held":
    case "already-undone":
    case "edit-refused":
    case "bad-cursor": {
      throw new Error(`a file's room answered ${refusal.kind}, which no upload meets`);
    }
    // no default
  }
};

const writeBlob = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  upload: { readonly accountId: string; readonly sha: string },
): Promise<Response> => {
  const bytes = declaredLength(request.headers);
  if (Number.isNaN(bytes) || request.body === null) {
    return text(411, "Send the file with its Content-Length.");
  }
  if (bytes > BLOB_MAX_BYTES) {
    return text(413, "This file is larger than the library keeps.");
  }
  const { accountId, sha } = upload;
  const cell = libraryCell(ctx.exports, accountId);
  const room = await cell.reserveBlob({
    bytes,
    mime: mediaTypeOf(request.headers.get("content-type")),
    sha,
  });
  if (!room.ok) {
    return refusalAnswer(room.refusal);
  }
  if (room.value.held) {
    await request.body.cancel();
    return new Response(null, { status: 204 });
  }
  try {
    await env.BLOBS.put(blobKey(accountId, sha), request.body, {
      httpMetadata: { contentType: mediaTypeOf(request.headers.get("content-type")) },
      sha256: sha,
    });
  } catch (error) {
    // R2 kept nothing: the settle finds nothing under the key and lets the room go
    console.warn({ event: "blob-upload-refused", ...errorFields(error) });
    await cell.settleBlob(sha);
    return text(400, "The file's bytes don't match the address they were sent to.");
  }
  const settled = await cell.settleBlob(sha);
  if (!settled.ok) {
    return refusalAnswer(settled.refusal);
  }
  // a removal of these bytes raced the upload: the room still stands, so the device sends again
  return settled.value.settled
    ? new Response(null, { status: 201 })
    : text(503, "Send the file again.", { "retry-after": "1" });
};

export const handleBlobRoute = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  if (isBelowFloor(request, env)) {
    return text(426, "This version of the app is too old. Update it to keep going.");
  }
  const sha = BLOB_PATH.exec(url.pathname)?.groups?.["sha"] ?? "";
  if (!SHA256_HEX_RE.test(sha)) {
    return text(404, "A file is named by its SHA-256.");
  }
  if (!["GET", "HEAD", "PUT"].includes(request.method)) {
    return text(405, "A file is read or written.", { allow: "GET, HEAD, PUT" });
  }
  const principal = await lazyPrincipal(request, env, ctx)();
  if (principal === null) {
    return text(401, "You're signed out. Sign in again.");
  }
  if (!(await spendDeviceBudget(env, createDb(env.DB), "blobs", holderIdOf(principal)))) {
    return text(429, "Too many requests. Try again in a minute.");
  }
  return request.method === "PUT"
    ? await writeBlob(request, env, ctx, { accountId: principal.accountId, sha })
    : await readBlob(request, env.BLOBS, blobKey(principal.accountId, sha));
};
