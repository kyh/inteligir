// `/v1/blobs/<sha>`: a file of the library, read by the doors `/v1` admits, under the file read
// minute. The file's row answers everything but the bytes, a missing file, a copy the device holds,
// a precondition and a range past the end, so the store is asked only to stream; the route spells
// the status, since a store may answer a range as a whole file. A stranger's html file is served
// under a script-less sandbox, any other file under a sandbox too, but a PDF, whose viewer a
// sandbox blanks. A file an item holds as its original is served under that item's name.

import { V1_BLOBS_NAME_PARAM } from "@repo/contract/library/library-blobs";
import { SHA256_HEX_RE } from "@repo/contract/library/library-item";
import { db } from "@repo/db/drizzle-client";

import { logUnhandled } from "../log";
import { admit } from "../rpc/admit";
import type { SessionDoor } from "../rpc/admit";
import { rpcFault, rpcRefusal } from "../rpc/rpc-refusal";
import { fileOf, servedNameOf } from "./file-names";
import type { HeldFile } from "./file-names";
import { FILE_STORE } from "./file-store-of";
import { plainText } from "./plain-text";
import type { ByteRange } from "./file-store";

const BLOB_PATH = /^\/v1\/blobs\/(?<sha>[^/]+)$/u;

// a range asked for to the end is answered this much at a time, so no read outlives a function
// (sp-ranged-stream); a media loader asks again from where an answer stopped
const OPEN_RANGE_BYTES = 8 * 1024 * 1024;

// a sandbox blanks WebKit's PDF viewer, so a PDF alone is served without one: its policy still runs
// no script and loads nothing but itself, and only this origin may frame it
const PDF_POLICY =
  "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";
// an html file is a stranger's page: the sandbox runs none of its script and gives it no origin,
// it loads only what it carries inline, and a link it holds, followed, names nothing here
const HTML_POLICY =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";
// any other file: an <img> never runs an svg's script, but a navigation to its url would
const SANDBOX_POLICY = "default-src 'none'; sandbox";

const serveUnder = (headers: Headers, mime: string): void => {
  if (mime === "application/pdf") {
    headers.set("content-security-policy", PDF_POLICY);
    return;
  }
  if (mime === "text/html") {
    headers.set("content-security-policy", HTML_POLICY);
    headers.set("referrer-policy", "no-referrer");
    return;
  }
  headers.set("content-security-policy", SANDBOX_POLICY);
};

// RFC 8187's ext-value, which spells any name in ASCII: encodeURIComponent leaves `'`, `(`, `)` and
// `*` bare, which its grammar reserves
const extValueOf = (name: string): string =>
  encodeURIComponent(name)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");

// the name a viewer titles the file by and a download saves it as; inline, so the file still opens
// where the page draws it
const nameUnder = (headers: Headers, name: string | null): void => {
  if (name !== null) {
    headers.set("content-disposition", `inline; filename*=UTF-8''${extValueOf(name)}`);
  }
};

// a file never changes under its sha, so a tab's browser keeps it as long as it likes, and no
// shared cache keeps it at all
const READ_HEADERS = {
  "accept-ranges": "bytes",
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
};

// whether an `if-match` or `if-none-match` list names the file's one etag
const namesEtag = (list: string, etag: string): boolean =>
  list
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//u, ""))
    .some((tag) => tag === "*" || tag === etag);

// whole seconds, as an HTTP date carries them
const secondsOf = (ms: number): number => Math.floor(ms / 1000);

// what the device's own copy or precondition makes of the read: a match it required and missed is
// 412; a copy it already holds 304, except under a range, since a media loader sends the etag it
// holds with every range it reads, and a 304 leaves it holding only its probe's bytes
const preconditionStatus = (request: Request, held: HeldFile, etag: string): 304 | 412 | null => {
  const { headers } = request;
  const ifMatch = headers.get("if-match");
  if (ifMatch !== null && !namesEtag(ifMatch, etag)) {
    return 412;
  }
  const ifUnmodifiedSince = Date.parse(headers.get("if-unmodified-since") ?? "");
  if (ifMatch === null && secondsOf(held.createdAt) > secondsOf(ifUnmodifiedSince)) {
    return 412;
  }
  if (headers.has("range")) {
    return null;
  }
  const ifNoneMatch = headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    return namesEtag(ifNoneMatch, etag) ? 304 : null;
  }
  const ifModifiedSince = Date.parse(headers.get("if-modified-since") ?? "");
  return secondsOf(held.createdAt) <= secondsOf(ifModifiedSince) ? 304 : null;
};

const SINGLE_RANGE = /^bytes=(?<first>\d*)-(?<last>\d*)$/u;

type RangeAsk =
  | { readonly kind: "whole" }
  | { readonly kind: "unsatisfiable" }
  | { readonly kind: "range"; readonly range: ByteRange };

// the one range a request asks for (RFC 9110 § 14.1.2), within the file: a multi-part ask, or none,
// is answered whole, as a server may, and a range that names no byte of the file is unsatisfiable
const rangeAskOf = (request: Request, size: number): RangeAsk => {
  const groups = SINGLE_RANGE.exec(
    (request.headers.get("range") ?? "").replaceAll(" ", ""),
  )?.groups;
  const first = groups?.first ?? "";
  const last = groups?.last ?? "";
  if (first === "" && last === "") {
    return { kind: "whole" };
  }
  if (first === "") {
    const suffix = Math.min(Number(last), size);
    return suffix === 0
      ? { kind: "unsatisfiable" }
      : { kind: "range", range: { end: size - 1, start: size - suffix } };
  }
  const start = Number(first);
  if (start >= size) {
    return { kind: "unsatisfiable" };
  }
  if (last !== "" && Number(last) < start) {
    return { kind: "whole" };
  }
  const end = last === "" ? start + OPEN_RANGE_BYTES - 1 : Number(last);
  return { kind: "range", range: { end: Math.min(end, size - 1), start } };
};

const contentRangeOf = ({ end, start }: ByteRange, size: number): string =>
  `bytes ${String(start)}-${String(end)}/${String(size)}`;

const answered = (
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
  range: ByteRange | null,
  size: number,
): Response => {
  if (range === null) {
    headers.set("content-length", String(size));
    return new Response(body, { headers, status: 200 });
  }
  headers.set("content-length", String(range.end - range.start + 1));
  headers.set("content-range", contentRangeOf(range, size));
  return new Response(body, { headers, status: 206 });
};

// An app keeps what it reads where a sign-out empties it; a copy in the HTTP cache under it, stored
// beside the session that read it, is one nothing empties. The site's own page keeps nothing of its
// own, so the browser's cache is where its files are kept, until its sign-out empties it
const readHeld = async (
  request: Request,
  {
    door,
    held,
    name,
    sha,
  }: {
    readonly door: SessionDoor;
    readonly held: HeldFile;
    readonly name: string | null;
    readonly sha: string;
  },
): Promise<Response> => {
  const etag = `"${sha}"`;
  const headers = new Headers(READ_HEADERS);
  if (door !== "page") {
    headers.set("cache-control", "no-store");
  }
  headers.set("content-type", held.mime);
  headers.set("etag", etag);
  headers.set("last-modified", new Date(held.createdAt).toUTCString());
  serveUnder(headers, held.mime);
  nameUnder(headers, name);
  const precondition = preconditionStatus(request, held, etag);
  if (precondition !== null) {
    return new Response(null, { headers, status: precondition });
  }
  const ask = rangeAskOf(request, held.bytes);
  if (ask.kind === "unsatisfiable") {
    headers.set("content-range", `bytes */${String(held.bytes)}`);
    return new Response(null, { headers, status: 416 });
  }
  const asked = ask.kind === "range" ? ask.range : null;
  // Next and Vercel drop a route's content-length on the way out, so a HEAD's never reaches the
  // device; a media loader takes the size from a range's content-range, which they keep
  if (request.method === "HEAD") {
    return answered(headers, null, asked, held.bytes);
  }
  const read = await FILE_STORE.read(held.pathname, asked);
  if (read === null) {
    return plainText(404, "That file isn't in the library.");
  }
  return answered(headers, read.body, read.range, held.bytes);
};

export const fileReadRoute = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const sha = BLOB_PATH.exec(url.pathname)?.groups?.sha ?? "";
  if (!SHA256_HEX_RE.test(sha)) {
    return plainText(404, "A file is named by its SHA-256.");
  }
  try {
    // the floor before the method, so a build older than the floor that sends its file here, as
    // builds before the store did, is told to update
    const admission = await admit(request, "fileRead");
    if (admission.kind === "refused") {
      return rpcRefusal(admission.refusal);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return plainText(405, "A file is read here.", { allow: "GET, HEAD" });
    }
    const { accountId, actor } = admission.principal;
    const [held, name] = await Promise.all([
      fileOf(db, accountId, sha),
      servedNameOf(db, accountId, sha, url.searchParams.get(V1_BLOBS_NAME_PARAM)),
    ]);
    if (held === null) {
      return plainText(404, "That file isn't in the library.");
    }
    return await readHeld(request, { door: actor.door, held, name, sha });
  } catch (error) {
    logUnhandled(request, error);
    return rpcFault();
  }
};
