// How the cloud reads a page it fills: the Workers runtime's own fetch, every hop of it judged before
// it is asked. Only http and https on their own ports, as a page is served; never a host whose
// spelling names a place off the public internet: this machine or a name no public resolver
// answers (`@repo/notes/items/host-names`), or an address written out in private or reserved space
// (`./address-space`), since the platform reaches a host by its name alone
// (https://developers.cloudflare.com/workers/platform/known-issues/) and from the public internet
// (`global_fetch_strictly_public`, so even this Worker's own zone is asked through its front door);
// a public address written out is asked like any name. Redirects are followed here, at most five,
// each hop judged again; no cookie or credential is sent; the whole read has a deadline (20 s), and
// a byte cap per kind is counted on the bytes as they arrive, after the platform has decoded them,
// so a compressed bomb stops at the cap. A refusal is said in the fill's own words
// (`@repo/notes/items/fill-sentences`).

import { statusFailure } from "@repo/notes/items/fill-sentences";
import type { FetchFailure } from "@repo/notes/items/fill-sentences";
import { isLoopbackName, isPrivateUseName } from "@repo/notes/items/host-names";

import { addressSpace } from "./address-space";
import type { AddressSpace } from "./address-space";

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

type PageFetchResult =
  | { readonly ok: true; readonly page: FetchedPage }
  | { readonly ok: false; readonly failure: FetchFailure };

export type PageFetch = (request: PageRequest) => Promise<PageFetchResult>;

// how long a whole read may take, its redirects and its body included
const DEADLINE_MS = 20_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
// a web page's own ports; "" is the scheme's default, which a parsed URL leaves unspelled
const WEB_PORTS: ReadonlySet<string> = new Set(["", "80", "443"]);

// a page is asked for as a browser would ask, naming the app after it, in the language most pages
// write in, since the cloud knows no reader's
const HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 inteligir",
};

const REFUSED_ADDRESS: FetchFailure = { kind: "refused", refusal: "reserved" };

// where a host the WHATWG parser wrote sits: an address by its space, a name by its spelling (this
// machine, or a name only a home's or an office's resolver answers)
const hostSpace = (hostname: string): AddressSpace =>
  addressSpace(hostname) ??
  (isLoopbackName(hostname) || isPrivateUseName(hostname) ? "private" : "public");

// the hop as it is asked, its credential dropped, or why it is not asked: off the web, off a web
// port, at an address no host holds, or in private space (said as the saved address's own place,
// or as a public page's pointing there)
const hopOf = (
  raw: string,
  from: string | null,
): { readonly url: string } | { readonly refused: FetchFailure } => {
  let url: URL;
  try {
    url = from === null ? new URL(raw) : new URL(raw, from);
  } catch {
    return { refused: REFUSED_ADDRESS };
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !WEB_PORTS.has(url.port)) {
    return { refused: REFUSED_ADDRESS };
  }
  url.username = "";
  url.password = "";
  switch (hostSpace(url.hostname)) {
    case "public": {
      return { url: url.href };
    }
    case "reserved": {
      return { refused: REFUSED_ADDRESS };
    }
    case "private": {
      return {
        refused: {
          kind: "refused",
          refusal: from === null ? "private-network" : "private-from-public",
        },
      };
    }
    // no default
  }
};

const contentType = (header: string | null) => {
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

// a body the fill stops reading; one whose cancel fails is the runtime's to drop
const cancelled = async (body: ReadableStream<Uint8Array> | null): Promise<void> => {
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
    chunks.push(read.value);
    length += read.value.length;
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

// the guarded fetch, its whole read held to `deadlineMs`
export const pageFetch =
  (options: { readonly deadlineMs: number }): PageFetch =>
  async (request) => {
    const first = hopOf(request.url, null);
    if ("refused" in first) {
      return { failure: first.refused, ok: false };
    }
    const signal = AbortSignal.timeout(options.deadlineMs);
    let { url } = first;
    try {
      for (let redirects = 0; ; redirects += 1) {
        const response = await fetch(url, {
          headers: { accept: request.accept, ...HEADERS },
          redirect: "manual",
          signal,
        });
        const location = REDIRECT_STATUSES.has(response.status)
          ? response.headers.get("location")
          : null;
        if (location === null) {
          return await answered(response, url, request);
        }
        await cancelled(response.body);
        if (redirects >= MAX_REDIRECTS) {
          return { failure: { kind: "redirects" }, ok: false };
        }
        const next = hopOf(location, url);
        if ("refused" in next) {
          return { failure: next.refused, ok: false };
        }
        ({ url } = next);
      }
    } catch {
      // a name that did not resolve, a connection cut, the read past its time: a later try may pass
      return {
        failure: signal.aborted ? { kind: "timeout" } : { kind: "unreachable", transient: true },
        ok: false,
      };
    }
  };

export const fetchPage: PageFetch = pageFetch({ deadlineMs: DEADLINE_MS });
