// What a page's fetch does over its host's own: the redirects followed, at most five, each hop put
// to the host's own rule, and the final answer read, its bytes counted against a cap as they arrive, after
// the platform has decoded them, so a compressed bomb stops at the cap. A host keeps which hops it
// asks, how it asks and the deadline, whose abort reaches here as a read that rejects.

import { statusFailure } from "./fill-sentences";
import type { FetchFailure } from "./fill-sentences";

export interface PageRequest {
  readonly url: string;
  readonly accept: string;
  // the body's bytes counted as they arrive, so a page with no declared size stops at the cap
  readonly maxBytes: number;
  // "truncate" keeps what fits (a page's head and text); "refuse" fails past it (a cover, a JSON)
  readonly overflow: "truncate" | "refuse";
}

export interface FetchedPage {
  // where the redirects ended
  readonly url: string;
  // lowercased, without parameters
  readonly mediaType: string | null;
  readonly charset: string | null;
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
  // the size the site declared, null when it declared none
  readonly declaredBytes: number | null;
}

export type PageFetchResult =
  | { readonly ok: true; readonly page: FetchedPage }
  | { readonly ok: false; readonly failure: FetchFailure };

// the hop as a host asks it, or why it does not
export type PageHop = { readonly url: string } | { readonly refused: FetchFailure };

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const contentType = (header: string | null) => {
  if (header === null) {
    return { charset: null, mediaType: null };
  }
  const [type = "", ...parameters] = header.split(";");
  const charset =
    parameters
      .map((parameter) => /^\s*charset\s*=\s*"?(?<value>[^";\s]+)"?/iu.exec(parameter))
      .find((match) => match !== null)?.groups?.value ?? null;
  const mediaType = type.trim().toLowerCase();
  return { charset, mediaType: mediaType === "" ? null : mediaType };
};

const declaredOf = (header: string | null): number | null => {
  const declared = header === null ? Number.NaN : Number(header);
  return Number.isInteger(declared) && declared >= 0 ? declared : null;
};

type BodyRead =
  | { readonly kind: "read"; readonly bytes: Uint8Array; readonly truncated: boolean }
  | { readonly kind: "too-large"; readonly bytes: number };

const joined = (chunks: readonly Uint8Array[], length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.subarray(0, length - at), at);
    at += Math.min(chunk.length, length - at);
  }
  return bytes;
};

// a body the read stops at; one whose cancel fails is the runtime's to drop
const cancelled = async (body: Response["body"]): Promise<void> => {
  try {
    await body?.cancel();
  } catch {
    // nothing more is read from it either way
  }
};

// the body up to the cap, the rest never read: the stream is cancelled once the cap is past
const readCapped = async (response: Response, request: PageRequest): Promise<BodyRead> => {
  const { body } = response;
  if (body === null) {
    return { bytes: new Uint8Array(), kind: "read", truncated: false };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("a response body read something other than bytes");
    }
    chunks.push(chunk);
    length += chunk.length;
    if (length > request.maxBytes) {
      reader.releaseLock();
      await cancelled(body);
      return request.overflow === "refuse"
        ? { bytes: length, kind: "too-large" }
        : { bytes: joined(chunks, request.maxBytes), kind: "read", truncated: true };
    }
  }
  return { bytes: joined(chunks, length), kind: "read", truncated: false };
};

// a final answer, read up to the request's cap
const answered = async (
  response: Response,
  url: string,
  request: PageRequest,
): Promise<PageFetchResult> => {
  if (response.status < 200 || response.status >= 300) {
    await cancelled(response.body);
    return { failure: statusFailure(response.status), ok: false };
  }
  const declaredBytes = declaredOf(response.headers.get("content-length"));
  if (request.overflow === "refuse" && declaredBytes !== null && declaredBytes > request.maxBytes) {
    await cancelled(response.body);
    return { failure: { bytes: declaredBytes, kind: "too-large" }, ok: false };
  }
  const body = await readCapped(response, request);
  if (body.kind === "too-large") {
    return { failure: { bytes: body.bytes, kind: "too-large" }, ok: false };
  }
  return {
    ok: true,
    page: {
      ...contentType(response.headers.get("content-type")),
      bytes: body.bytes,
      declaredBytes,
      truncated: body.truncated,
      url,
    },
  };
};

export const followRedirects = async (args: {
  readonly first: string;
  readonly request: PageRequest;
  // the platform's fetch of one hop, redirects left to this
  readonly ask: (url: string) => Promise<Response>;
  // where a Location leads from the hop it came from, as the host judges it
  readonly hop: (location: string, from: string) => PageHop;
}): Promise<PageFetchResult> => {
  let url = args.first;
  for (let redirects = 0; ; redirects += 1) {
    const response = await args.ask(url);
    const location = REDIRECT_STATUSES.has(response.status)
      ? response.headers.get("location")
      : null;
    if (location === null) {
      return await answered(response, url, args.request);
    }
    await cancelled(response.body);
    if (redirects >= MAX_REDIRECTS) {
      return { failure: { kind: "redirects" }, ok: false };
    }
    const next = args.hop(location, url);
    if ("refused" in next) {
      return { failure: next.refused, ok: false };
    }
    ({ url } = next);
  }
};
