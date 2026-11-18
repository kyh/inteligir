// How the cloud reads a page it fills: undici's fetch through a dispatcher that connects only to an
// address a lookup vetted as public (`./public-dispatcher`), every hop of it judged before it is
// asked. Only http and https on their own ports, as a page is served, and only at a name
// (`@repo/contract/items/host-names`): never an address written out, and never this machine or a
// name no public resolver answers, refused by their spelling before any lookup; a name that resolves
// into private space is refused by the dispatcher before it connects. The redirects are followed
// here, at most five, each resolved and vetted again, and the final answer read, its bytes counted
// against a cap as they arrive, after undici has decoded them, so a compressed bomb stops at the
// cap. No cookie or credential is sent, and the whole read has a deadline (20 s), whose abort reaches
// the read as a rejection. A refusal is said in the fill's own words (`./fill-sentences`).

import {
  isAddressLiteral,
  isLoopbackName,
  isPrivateUseName,
} from "@repo/contract/items/host-names";

import { fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";

import { statusFailure } from "./fill-sentences";
import type { FetchFailure, FetchRefusal } from "./fill-sentences";
import { PrivateAddressError, publicDispatcher } from "./public-dispatcher";
import { RELAYED_FETCH } from "./relayed-page-fetch";

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

// a hop's body as the read takes it: its chunks one at a time, and the rest let go
interface HopBody {
  readonly getReader: () => {
    readonly read: () => Promise<{ readonly done: boolean; readonly value?: unknown }>;
    readonly releaseLock: () => void;
  };
  readonly cancel: () => Promise<void>;
}

// what one hop answers, as undici's fetch and the platform's both give it, whose streams the type
// libraries spell apart
interface HopAnswer {
  readonly status: number;
  readonly headers: { readonly get: (name: string) => string | null };
  readonly body: HopBody | null;
}

interface HopInit {
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect: "manual";
  readonly signal: AbortSignal;
}

// one hop asked, its redirect left to the read
export type HopFetch = (url: string, init: HopInit) => Promise<HopAnswer>;

// how long a whole read may take, its redirects and its body included
const DEADLINE_MS = 20_000;
// a web page's own ports; "" is the scheme's default, which a parsed URL leaves unspelled
const WEB_PORTS: ReadonlySet<string> = new Set(["", "80", "443"]);
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

// a page is asked for as a browser would ask, naming the app after it, in the language most pages
// write in, since the cloud knows no reader's
const HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 inteligir",
};

interface Refused {
  readonly refused: FetchFailure;
}

const refused = (refusal: FetchRefusal): Refused => ({ refused: { kind: "refused", refusal } });

type PageHop = { readonly url: string } | Refused;

// the hop as it is asked, its credential dropped, or why it is not asked: off the web, off a web
// port, at an address written out, or at a name for private space (said as the saved address's own
// place, or as a public page's pointing there)
const hopOf = (raw: string, from: string | null): PageHop => {
  let url: URL;
  try {
    url = from === null ? new URL(raw) : new URL(raw, from);
  } catch {
    return refused("off-web");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !WEB_PORTS.has(url.port)) {
    return refused("off-web");
  }
  // an address before a name: a bracketed one holds no dot, which is how a private-use name reads
  if (isAddressLiteral(url.hostname)) {
    return refused("address-literal");
  }
  if (isLoopbackName(url.hostname) || isPrivateUseName(url.hostname)) {
    return refused(from === null ? "private-network" : "private-from-public");
  }
  url.username = "";
  url.password = "";
  return { url: url.href };
};

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
const cancelled = async (body: HopAnswer["body"]): Promise<void> => {
  try {
    await body?.cancel();
  } catch {
    // nothing more is read from it either way
  }
};

// the body up to the cap, the rest never read: the stream is cancelled once the cap is past
const readCapped = async (response: HopAnswer, request: PageRequest): Promise<BodyRead> => {
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
  response: HopAnswer,
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

// whether a name a hop asked for resolved into private space, which undici gives as a cause of the
// rejection
const resolvedPrivate = (cause: unknown): boolean => {
  for (let at = cause; at instanceof Error; at = at.cause) {
    if (at instanceof PrivateAddressError) {
      return true;
    }
  }
  return false;
};

type HopAsked = { readonly answer: HopAnswer } | Refused;

// one hop asked; a name that resolved into private space is said as the saved address's own place,
// or as a public page's pointing there
const askHop = async (
  fetch: HopFetch,
  url: string,
  init: HopInit,
  redirected: boolean,
): Promise<HopAsked> => {
  try {
    return { answer: await fetch(url, init) };
  } catch (error) {
    if (resolvedPrivate(error)) {
      return refused(redirected ? "private-from-public" : "private-network");
    }
    throw error;
  }
};

// the page from its first hop on: each redirect judged where it points before it is asked
const followed = async (
  fetch: HopFetch,
  first: string,
  request: PageRequest,
  signal: AbortSignal,
): Promise<PageFetchResult> => {
  const init: HopInit = {
    headers: { accept: request.accept, ...HEADERS },
    redirect: "manual",
    signal,
  };
  let url = first;
  for (let redirects = 0; ; redirects += 1) {
    const asked = await askHop(fetch, url, init, redirects > 0);
    if ("refused" in asked) {
      return { failure: asked.refused, ok: false };
    }
    const response = asked.answer;
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
};

// the guarded read over `fetch`, its whole read held to `deadlineMs`
export const pageFetch =
  (options: { readonly deadlineMs: number; readonly fetch: HopFetch }): PageFetch =>
  async (request) => {
    const first = hopOf(request.url, null);
    if ("refused" in first) {
      return { failure: first.refused, ok: false };
    }
    const signal = AbortSignal.timeout(options.deadlineMs);
    try {
      return await followed(options.fetch, first.url, request, signal);
    } catch {
      // a name that did not resolve, a connection cut, the read past its time: a later try may pass
      return { failure: signal.aborted ? { kind: "timeout" } : { kind: "unreachable" }, ok: false };
    }
  };

// hops asked of the network through `dispatcher`
export const dispatchedFetch =
  (dispatcher: Dispatcher): HopFetch =>
  async (url, init) =>
    await undiciFetch(url, { ...init, dispatcher });

// One dispatcher for every read: each connection it opens runs the vetted lookup, and one it pools
// stays on the address that lookup passed
export const fetchPage: PageFetch = pageFetch({
  deadlineMs: DEADLINE_MS,
  fetch: RELAYED_FETCH ?? dispatchedFetch(publicDispatcher()),
});
