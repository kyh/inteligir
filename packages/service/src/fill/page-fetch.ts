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

export interface PageRequest {
  readonly url: string;
  readonly accept: string;
  readonly maxBytes: number;
  readonly overflow: "truncate" | "refuse";
}

export interface FetchedPage {
  readonly url: string;
  readonly mediaType: string | null;
  readonly charset: string | null;
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
  readonly declaredBytes: number | null;
}

type PageFetchResult =
  | { readonly ok: true; readonly page: FetchedPage }
  | { readonly ok: false; readonly failure: FetchFailure };

export type PageFetch = (request: PageRequest) => Promise<PageFetchResult>;

interface HopBody {
  readonly getReader: () => {
    readonly read: () => Promise<{ readonly done: boolean; readonly value?: unknown }>;
    readonly releaseLock: () => void;
  };
  readonly cancel: () => Promise<void>;
}

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

export type HopFetch = (url: string, init: HopInit) => Promise<HopAnswer>;

const DEADLINE_MS = 20_000;
const WEB_PORTS: ReadonlySet<string> = new Set(["", "80", "443"]);
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 inteligir",
};

interface Refused {
  readonly refused: FetchFailure;
}

const refused = (refusal: FetchRefusal) =>
  ({ refused: { kind: "refused", refusal } }) satisfies Refused;

type PageHop = { readonly url: string } | Refused;

const hopOf = (raw: string, from: string | null) => {
  let url: URL;

  try {
    url = from === null ? new URL(raw) : new URL(raw, from);
  } catch {
    return refused("off-web");
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || !WEB_PORTS.has(url.port)) {
    return refused("off-web");
  }

  if (isAddressLiteral(url.hostname)) {
    return refused("address-literal");
  }

  if (isLoopbackName(url.hostname) || isPrivateUseName(url.hostname)) {
    return refused(from === null ? "private-network" : "private-from-public");
  }

  url.username = "";
  url.password = "";

  return { url: url.href } satisfies PageHop;
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

const declaredOf = (header: string | null) => {
  const declared = header === null ? Number.NaN : Number(header);

  return Number.isInteger(declared) && declared >= 0 ? declared : null;
};

type BodyRead =
  | { readonly kind: "read"; readonly bytes: Uint8Array; readonly truncated: boolean }
  | { readonly kind: "too-large"; readonly bytes: number };

const joined = (chunks: readonly Uint8Array[], length: number) => {
  const bytes = new Uint8Array(length);
  let at = 0;

  for (const chunk of chunks) {
    bytes.set(chunk.subarray(0, length - at), at);
    at += Math.min(chunk.length, length - at);
  }

  return bytes;
};

const cancelled = async (body: HopAnswer["body"]) => {
  await Promise.allSettled([body?.cancel()]);
};

const readCapped = async (response: HopAnswer, request: PageRequest) => {
  const { body } = response;

  if (body === null) {
    return { bytes: new Uint8Array(), kind: "read", truncated: false } satisfies BodyRead;
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

      return (
        request.overflow === "refuse"
          ? { bytes: length, kind: "too-large" }
          : { bytes: joined(chunks, request.maxBytes), kind: "read", truncated: true }
      ) satisfies BodyRead;
    }
  }

  return { bytes: joined(chunks, length), kind: "read", truncated: false } satisfies BodyRead;
};

const answered = async (response: HopAnswer, url: string, request: PageRequest) => {
  if (response.status < 200 || response.status >= 300) {
    await cancelled(response.body);

    return { failure: statusFailure(response.status), ok: false } satisfies PageFetchResult;
  }

  const declaredBytes = declaredOf(response.headers.get("content-length"));

  if (request.overflow === "refuse" && declaredBytes !== null && declaredBytes > request.maxBytes) {
    await cancelled(response.body);

    return {
      failure: { bytes: declaredBytes, kind: "too-large" },
      ok: false,
    } satisfies PageFetchResult;
  }

  const body = await readCapped(response, request);

  if (body.kind === "too-large") {
    return {
      failure: { bytes: body.bytes, kind: "too-large" },
      ok: false,
    } satisfies PageFetchResult;
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
  } satisfies PageFetchResult;
};

const resolvedPrivate = (cause: unknown) => {
  for (let at = cause; at instanceof Error; at = at.cause) {
    if (at instanceof PrivateAddressError) {
      return true;
    }
  }

  return false;
};

type HopAsked = { readonly answer: HopAnswer } | Refused;

const askHop = async (fetch: HopFetch, url: string, init: HopInit, redirected: boolean) => {
  try {
    return { answer: await fetch(url, init) } satisfies HopAsked;
  } catch (error) {
    if (resolvedPrivate(error)) {
      return refused(redirected ? "private-from-public" : "private-network");
    }

    throw error;
  }
};

const followed = async (
  fetch: HopFetch,
  first: string,
  request: PageRequest,
  signal: AbortSignal,
) => {
  const init: HopInit = {
    headers: { accept: request.accept, ...HEADERS },
    redirect: "manual",
    signal,
  };

  let url = first;

  for (let redirects = 0; ; redirects += 1) {
    const asked = await askHop(fetch, url, init, redirects > 0);

    if ("refused" in asked) {
      return { failure: asked.refused, ok: false } satisfies PageFetchResult;
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
      return { failure: { kind: "redirects" }, ok: false } satisfies PageFetchResult;
    }

    const next = hopOf(location, url);

    if ("refused" in next) {
      return { failure: next.refused, ok: false } satisfies PageFetchResult;
    }

    ({ url } = next);
  }
};

export const pageFetch = (options: { readonly deadlineMs: number; readonly fetch: HopFetch }) =>
  (async (request) => {
    const first = hopOf(request.url, null);

    if ("refused" in first) {
      return { failure: first.refused, ok: false };
    }

    const signal = AbortSignal.timeout(options.deadlineMs);

    try {
      return await followed(options.fetch, first.url, request, signal);
    } catch {
      return { failure: signal.aborted ? { kind: "timeout" } : { kind: "unreachable" }, ok: false };
    }
  }) satisfies PageFetch;

export const dispatchedFetch = (dispatcher: Dispatcher) =>
  (async (url, init) => await undiciFetch(url, { ...init, dispatcher })) satisfies HopFetch;

export const fetchPage: PageFetch = pageFetch({
  deadlineMs: DEADLINE_MS,
  fetch: dispatchedFetch(publicDispatcher()),
});
