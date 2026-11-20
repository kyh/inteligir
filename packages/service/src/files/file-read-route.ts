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

const OPEN_RANGE_BYTES = 8 * 1024 * 1024;

const PDF_POLICY =
  "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";

const HTML_POLICY =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

// WARNING: an <img> never runs an svg's script, but a navigation to its url would, so every other file is sandboxed
const SANDBOX_POLICY = "default-src 'none'; sandbox";

const serveUnder = (headers: Headers, mime: string) => {
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

const extValueOf = (name: string) =>
  encodeURIComponent(name)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");

const nameUnder = (headers: Headers, name: string | null) => {
  if (name !== null) {
    headers.set("content-disposition", `inline; filename*=UTF-8''${extValueOf(name)}`);
  }
};

const READ_HEADERS = {
  "accept-ranges": "bytes",
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
};

const namesEtag = (list: string, etag: string) =>
  list
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//u, ""))
    .some((tag) => tag === "*" || tag === etag);

const secondsOf = (ms: number) => Math.floor(ms / 1000);

const preconditionStatus = (request: Request, held: HeldFile, etag: string) => {
  const { headers } = request;
  const ifMatch = headers.get("if-match");

  if (ifMatch !== null && !namesEtag(ifMatch, etag)) {
    return 412 as const;
  }

  const ifUnmodifiedSince = Date.parse(headers.get("if-unmodified-since") ?? "");

  if (ifMatch === null && secondsOf(held.createdAt) > secondsOf(ifUnmodifiedSince)) {
    return 412 as const;
  }

  if (headers.has("range")) {
    return null;
  }

  const ifNoneMatch = headers.get("if-none-match");

  if (ifNoneMatch !== null) {
    return (namesEtag(ifNoneMatch, etag) ? 304 : null) satisfies 304 | 412 | null;
  }

  const ifModifiedSince = Date.parse(headers.get("if-modified-since") ?? "");

  return (secondsOf(held.createdAt) <= secondsOf(ifModifiedSince) ? 304 : null) satisfies
    | 304
    | 412
    | null;
};

const SINGLE_RANGE = /^bytes=(?<first>\d*)-(?<last>\d*)$/u;

type RangeAsk =
  | { readonly kind: "whole" }
  | { readonly kind: "unsatisfiable" }
  | { readonly kind: "range"; readonly range: ByteRange };

const rangeAskOf = (request: Request, size: number) => {
  const groups = SINGLE_RANGE.exec(
    (request.headers.get("range") ?? "").replaceAll(" ", ""),
  )?.groups;

  const first = groups?.first ?? "";
  const last = groups?.last ?? "";

  if (first === "" && last === "") {
    return { kind: "whole" } satisfies RangeAsk;
  }

  if (first === "") {
    const suffix = Math.min(Number(last), size);

    return (
      suffix === 0
        ? { kind: "unsatisfiable" }
        : { kind: "range", range: { end: size - 1, start: size - suffix } }
    ) satisfies RangeAsk;
  }

  const start = Number(first);

  if (start >= size) {
    return { kind: "unsatisfiable" } satisfies RangeAsk;
  }

  if (last !== "" && Number(last) < start) {
    return { kind: "whole" } satisfies RangeAsk;
  }

  const end = last === "" ? start + OPEN_RANGE_BYTES - 1 : Number(last);

  return { kind: "range", range: { end: Math.min(end, size - 1), start } } satisfies RangeAsk;
};

const contentRangeOf = ({ end, start }: ByteRange, size: number) =>
  `bytes ${String(start)}-${String(end)}/${String(size)}`;

const answered = (
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
  range: ByteRange | null,
  size: number,
) => {
  if (range === null) {
    headers.set("content-length", String(size));

    return new Response(body, { headers, status: 200 });
  }

  headers.set("content-length", String(range.end - range.start + 1));
  headers.set("content-range", contentRangeOf(range, size));

  return new Response(body, { headers, status: 206 });
};

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
) => {
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

  if (request.method === "HEAD") {
    return answered(headers, null, asked, held.bytes);
  }

  const read = await FILE_STORE.read(held.pathname, asked);

  if (read === null) {
    return plainText(404, "That file isn't in the library.");
  }

  return answered(headers, read.body, read.range, held.bytes);
};

export const fileReadRoute = async (request: Request) => {
  const url = new URL(request.url);
  const sha = BLOB_PATH.exec(url.pathname)?.groups?.sha ?? "";

  if (!SHA256_HEX_RE.test(sha)) {
    return plainText(404, "A file is named by its SHA-256.");
  }

  try {
    const admission = await admit(request, "fileRead");

    if (admission.kind === "refused") {
      return rpcRefusal(admission.refusal);
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
