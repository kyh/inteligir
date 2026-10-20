// How the phone reads a link it saved: the platform's fetch (Expo's streams its body), http and
// https alone, at most 20 s a request and a byte cap per kind, as the Mac's fill reads them, with
// no cookie or credential sent. A redirect is the platform's to follow. The phone has no lookup to
// vet an answer's addresses as the Mac's guard does, so where a page's claims may lead it is judged
// before the request by the address's spelling (`namesPrivateSpace`, in link-fill.ts).
// Platform-free: the suite and the scenario suite hand it node's fetch.

import { statusFailure } from "@repo/notes/items/fill-sentences";
import type { FetchFailure } from "@repo/notes/items/fill-sentences";
import { isWebUrl } from "@repo/notes/items/item-url";

// the fetch the phone's runtime installs, typed as far as this reads it
export type PlatformFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface PageRequest {
  url: string;
  accept: string;
  // the body's bytes counted as they arrive, so a page with no declared size stops at the cap
  maxBytes: number;
  // "truncate" keeps what fits (a page's head and text); "refuse" fails past it (a cover, a JSON)
  overflow: "truncate" | "refuse";
}

export interface FetchedPage {
  // where the platform's redirects ended
  url: string;
  // lowercased, without parameters
  mediaType: string | null;
  charset: string | null;
  bytes: Uint8Array;
  truncated: boolean;
  // the size the site declared, null when it declared none
  declaredBytes: number | null;
}

export type PageFetchResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; failure: FetchFailure };

export type PageFetch = (request: PageRequest) => Promise<PageFetchResult>;

const REQUEST_TIMEOUT_MS = 20_000;

interface ContentType {
  mediaType: string | null;
  charset: string | null;
}

const contentType = (header: string | null): ContentType => {
  if (header === null) {
    return { charset: null, mediaType: null };
  }
  const [type = "", ...parameters] = header.split(";");
  const charset =
    parameters
      .map((parameter) => /^\s*charset\s*=\s*"?(?<value>[^";\s]+)"?/iu.exec(parameter))
      .find((match) => match !== null)?.groups?.["value"] ?? null;
  const mediaType = type.trim().toLowerCase();
  return { charset, mediaType: mediaType === "" ? null : mediaType };
};

const declaredOf = (header: string | null): number | null => {
  const declared = header === null ? Number.NaN : Number(header);
  return Number.isInteger(declared) && declared >= 0 ? declared : null;
};

type BodyRead =
  | { kind: "read"; bytes: Uint8Array; truncated: boolean }
  | { kind: "too-large"; bytes: number };

const joined = (chunks: readonly Uint8Array[], length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.subarray(0, length - at), at);
    at += Math.min(chunk.length, length - at);
  }
  return bytes;
};

// a body the fill stops reading: a stream that fails to close is the platform's to drop
const closed = async (cancelling: Promise<void> | undefined): Promise<void> => {
  try {
    await cancelling;
  } catch {
    // nothing more is read from it either way
  }
};

// the body up to the cap, the rest never read: the stream is cancelled once the cap is past
const readCapped = async (response: Response, request: PageRequest): Promise<BodyRead> => {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length <= request.maxBytes) {
      return { bytes: whole, kind: "read", truncated: false };
    }
    return request.overflow === "refuse"
      ? { bytes: whole.length, kind: "too-large" }
      : { bytes: whole.subarray(0, request.maxBytes), kind: "read", truncated: true };
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      return { bytes: joined(chunks, length), kind: "read", truncated: false };
    }
    chunks.push(next.value);
    length += next.value.length;
    if (length > request.maxBytes) {
      await closed(reader.cancel());
      return request.overflow === "refuse"
        ? { bytes: length, kind: "too-large" }
        : { bytes: joined(chunks, request.maxBytes), kind: "read", truncated: true };
    }
  }
};

export const createPageFetch =
  (
    platformFetch: PlatformFetch,
    headers: { userAgent: string; acceptLanguage: string },
  ): PageFetch =>
  async (request) => {
    if (!isWebUrl(request.url)) {
      return { failure: { kind: "unreachable", transient: false }, ok: false };
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await platformFetch(request.url, {
        credentials: "omit",
        headers: {
          Accept: request.accept,
          "Accept-Language": headers.acceptLanguage,
          "User-Agent": headers.userAgent,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.status < 200 || response.status >= 400) {
        await closed(response.body?.cancel());
        return { failure: statusFailure(response.status), ok: false };
      }
      const declaredBytes = declaredOf(response.headers.get("content-length"));
      if (
        request.overflow === "refuse" &&
        declaredBytes !== null &&
        declaredBytes > request.maxBytes
      ) {
        await closed(response.body?.cancel());
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
          url: response.url === "" ? request.url : response.url,
        },
      };
    } catch {
      // offline, a name that did not resolve, a connection cut: a later try may get through
      return {
        failure: timedOut ? { kind: "timeout" } : { kind: "unreachable", transient: true },
        ok: false,
      };
    } finally {
      clearTimeout(timer);
    }
  };
