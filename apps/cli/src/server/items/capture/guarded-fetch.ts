// the one dial every save makes: a page, its cover, an oEmbed answer, a page copy's stylesheets
// and pictures. Each hop's URL is parsed with WHATWG URL (which reduces `2130706433`, `0x7f.1` and
// `127.1` to `127.0.0.1` and unbrackets IPv6), an IP literal is vetted before the dial (node skips
// the lookup for one), and a name is resolved once, every address of the answer vetted, and that
// vetted list alone handed to the socket's lookup, so no second resolution can rebind it. Redirects
// are followed by hand, each hop vetted again, at most five. No cookie, credential or referrer is
// ever sent, and no env var widens what may be dialed.

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, STATUS_CODES } from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { pipeline } from "node:stream";
import type { Readable, Transform } from "node:stream";
import { getCACertificates, rootCertificates } from "node:tls";
import { createBrotliDecompress, createGunzip, createUnzip } from "node:zlib";

import { errnoCode } from "../../errno";
import {
  addressKey,
  classifyAddress,
  isThisMacName,
  reachedKeys,
  vetAnswer,
} from "./address-guard";
import type { AddressClass, AddressPolicy, GuardRefusal, Reach } from "./address-guard";

export interface LookupAddress {
  address: string;
  family: number;
}

// every address a name resolves to, in the resolver's own order
export type HostLookup = (hostname: string) => Promise<LookupAddress[]>;

export type FetchFailure =
  | { kind: "refused"; refusal: GuardRefusal }
  // `reason` is node's own wording of the status, never the site's
  | { kind: "status"; status: number; reason: string; transient: boolean }
  | { kind: "timeout" }
  | { kind: "unreachable"; transient: boolean }
  | { kind: "tls" }
  | { kind: "redirects" }
  // `bytes`: the size the site declared, or what had arrived when the read stopped
  | { kind: "too-large"; bytes: number }
  | { kind: "aborted" };

export interface FetchedResponse {
  // the last hop's url
  url: string;
  status: number;
  // lowercased, without parameters
  mediaType: string | null;
  charset: string | null;
  bytes: Uint8Array;
  // the body passed `maxBytes` and was cut there (overflow "truncate")
  truncated: boolean;
  reach: Reach;
}

export type FetchResult =
  | { ok: true; response: FetchedResponse }
  | { ok: false; failure: FetchFailure };

export interface FetchRequest {
  url: string;
  // null: this is the saved address, whose own answer decides what every later hop may reach
  reach: Reach | null;
  // the decoded size counted, so a compressed bomb stops at the cap
  maxBytes: number;
  overflow: "truncate" | "refuse";
  accept: string;
  signal?: AbortSignal | undefined;
}

export type ReachResult = { ok: true; reach: Reach } | { ok: false; failure: FetchFailure };

export interface GuardedFetch {
  fetch: (request: FetchRequest) => Promise<FetchResult>;
  // the saved address's reach without requesting it: a captured page is never fetched, but its
  // covers and copy resources are, and they may enter private space only if the page's host is
  // private itself
  reachOf: (url: string, signal?: AbortSignal) => Promise<ReachResult>;
}

export interface GuardedFetchDeps {
  ownPort: () => number | null;
  userAgent: string;
  acceptLanguage: string;
  // a suite's resolver and classification (CapturePorts); the system's resolver and
  // classifyAddress otherwise
  lookup?: HostLookup | undefined;
  policy?: AddressPolicy | undefined;
  // the addresses this Mac's network interfaces hold, read at every hop; the system's own,
  // loopback left out (the policy judges it this Mac's already), otherwise
  ownAddresses?: (() => readonly string[]) | undefined;
  // the trust store; the bundled roots and the system's otherwise
  ca?: readonly string[] | undefined;
  connectTimeoutMs?: number | undefined;
  requestTimeoutMs?: number | undefined;
  // every address handed to a socket, for a suite to check it dials only what was vetted
  onDial?: ((addresses: readonly LookupAddress[]) => void) | undefined;
}

const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 20_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// what a fill retries later: the site said so, or nothing answered in time
const TRANSIENT_STATUSES = new Set([429, 503]);
const TRANSIENT_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);
const TLS_CODE = /^(?:CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|ERR_SSL_)/u;

const systemLookup: HostLookup = async (hostname) =>
  await dnsLookup(hostname, { all: true, order: "verbatim" });

const defaultCa = (): string[] => [...rootCertificates, ...getCACertificates("system")];

const interfaceAddresses = (): string[] =>
  Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).filter((entry) => !entry.internal).map((entry) => entry.address),
  );

const failureOfError = (cause: unknown): FetchFailure => {
  const code = errnoCode(cause);
  if (code !== undefined && TLS_CODE.test(code)) {
    return { kind: "tls" };
  }
  return { kind: "unreachable", transient: code !== undefined && TRANSIENT_CODES.has(code) };
};

const defaultPort = (protocol: string): number => (protocol === "https:" ? 443 : 80);

interface Hop {
  url: URL;
  host: string;
  port: number;
}

const hopOf = (raw: string, base?: URL): Hop | null => {
  let url: URL;
  try {
    url = base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  // a location's credential is never sent, and never named as the page's address
  url.username = "";
  url.password = "";
  const host = url.hostname.replaceAll(/^\[|\]$/gu, "");
  if (host === "") {
    return null;
  }
  const port = url.port === "" ? defaultPort(url.protocol) : Number(url.port);
  return { host, port, url };
};

const parseContentType = (header: string | undefined) => {
  if (header === undefined) {
    return { charset: null, mediaType: null };
  }
  const [type = "", ...params] = header.split(";");
  const charset = params
    .map((param) => param.trim())
    .find((param) => param.toLowerCase().startsWith("charset="));
  return {
    charset:
      charset === undefined
        ? null
        : charset
            .slice("charset=".length)
            .replaceAll(/^["']|["']$/gu, "")
            .trim()
            .toLowerCase(),
    mediaType: type.trim().toLowerCase() || null,
  };
};

const decoderOf = (encoding: string): Transform | null => {
  if (encoding === "gzip" || encoding === "x-gzip") {
    return createGunzip();
  }
  if (encoding === "deflate") {
    return createUnzip();
  }
  return encoding === "br" ? createBrotliDecompress() : null;
};

// the body as the site meant it. A decoder is joined by `pipeline`, never `pipe`: a body cut off
// or held past the deadline destroys the response, and only `pipeline` carries that to the
// decoder, so the read ends rather than waiting on a decoder nothing will ever end
const decodedStream = (response: IncomingMessage): Readable => {
  const decoder = decoderOf((response.headers["content-encoding"] ?? "").trim().toLowerCase());
  if (decoder === null) {
    return response;
  }
  // pipeline destroys the decoder with the response's error, which the read then throws
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- only the callback form hands back the decoder to read
  return pipeline(response, decoder, (error) => {
    if (error instanceof Error) {
      decoder.destroy(error);
    }
  });
};

type BodyRead =
  | { ok: true; bytes: Uint8Array; truncated: boolean }
  | { ok: false; failure: FetchFailure };

const readBody = async (
  response: IncomingMessage,
  request: FetchRequest,
  declared: number | null,
): Promise<BodyRead> => {
  const stream = decodedStream(response);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (total + piece.byteLength > request.maxBytes) {
        if (request.overflow === "refuse") {
          return {
            failure: {
              bytes: Math.max(declared ?? 0, total + piece.byteLength),
              kind: "too-large",
            },
            ok: false,
          };
        }
        chunks.push(piece.subarray(0, request.maxBytes - total));
        total = request.maxBytes;
        return { bytes: new Uint8Array(Buffer.concat(chunks)), ok: true, truncated: true };
      }
      chunks.push(piece);
      total += piece.byteLength;
    }
  } catch (error) {
    return { failure: failureOfError(error), ok: false };
  } finally {
    stream.destroy();
    response.destroy();
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), ok: true, truncated: false };
};

type Answered = { ok: true; response: IncomingMessage } | { ok: false; failure: FetchFailure };

export const createGuardedFetch = (deps: GuardedFetchDeps): GuardedFetch => {
  const lookup = deps.lookup ?? systemLookup;
  const policy = deps.policy ?? classifyAddress;
  const ownAddresses = deps.ownAddresses ?? interfaceAddresses;

  // an address of this Mac's own that reads as public (an interface's global IPv6, a public IPv4
  // it was handed) is this Mac's: a public name answering it would reach every service bound on
  // all of this Mac's addresses. Its private ones stay private space, which only a private saved
  // address reaches
  const classesOf = (addresses: readonly LookupAddress[]): AddressClass[] => {
    const own = new Set(ownAddresses().flatMap((address) => addressKey(address) ?? []));
    return addresses.map((entry) => {
      const judged = policy(entry.address);
      return judged === "public" && reachedKeys(entry.address).some((key) => own.has(key))
        ? "this-mac"
        : judged;
    });
  };
  const ca = deps.ca ?? defaultCa();
  const connectTimeoutMs = deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const requestTimeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  type Vetted =
    | { ok: true; reach: Reach; addresses: LookupAddress[] }
    | { ok: false; failure: FetchFailure };

  const vetHop = async (hop: Hop, reach: Reach | null): Promise<Vetted> => {
    if (hop.port === deps.ownPort() || isThisMacName(hop.host)) {
      return { failure: { kind: "refused", refusal: "this-mac" }, ok: false };
    }
    let addresses: LookupAddress[];
    const family = isIP(hop.host);
    if (family === 0) {
      try {
        addresses = await lookup(hop.host);
      } catch (error) {
        return { failure: failureOfError(error), ok: false };
      }
    } else {
      addresses = [{ address: hop.host, family }];
    }
    const verdict = vetAnswer(classesOf(addresses), reach);
    return verdict.ok
      ? { addresses, ok: true, reach: verdict.reach }
      : { failure: { kind: "refused", refusal: verdict.refusal }, ok: false };
  };

  // answers the socket's lookup with the vetted list alone, filtered to the family it asks for.
  // node's lookup hook is callback-shaped, and the socket waits on that callback
  const vettedLookup =
    (addresses: readonly LookupAddress[]): LookupFunction =>
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- net.connect's lookup option is a callback API
    (_hostname, options, callback) => {
      const wanted =
        options.family === 4 || options.family === 6
          ? addresses.filter((entry) => entry.family === options.family)
          : [...addresses];
      deps.onDial?.(wanted);
      const [first] = wanted;
      if (first === undefined) {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- see above
        callback(Object.assign(new Error("no vetted address"), { code: "ENOTFOUND" }), "", 0);
        return;
      }
      if (options.all === true) {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- see above
        callback(null, wanted);
        return;
      }
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- see above
      callback(null, first.address, first.family);
    };

  const send = async (
    hop: Hop,
    addresses: readonly LookupAddress[],
    request: FetchRequest,
    signal: AbortSignal,
  ): Promise<Answered> => {
    const literal = isIP(hop.host) !== 0;
    const options: RequestOptions & { autoSelectFamily: boolean; servername?: string } = {
      agent: false,
      autoSelectFamily: true,
      headers: {
        accept: request.accept,
        "accept-encoding": "gzip, deflate, br",
        "accept-language": deps.acceptLanguage,
        "user-agent": deps.userAgent,
      },
      host: hop.host,
      method: "GET",
      path: `${hop.url.pathname}${hop.url.search}`,
      port: hop.port,
      signal,
    };
    if (!literal) {
      options.lookup = vettedLookup(addresses);
    }
    const answered = Promise.withResolvers<Answered>();
    let client: ClientRequest;
    if (hop.url.protocol === "https:") {
      const secure = { ...options, ca: [...ca], rejectUnauthorized: true };
      if (!literal) {
        secure.servername = hop.host;
      }
      client = httpsRequest(secure, (response) => {
        answered.resolve({ ok: true, response });
      });
    } else {
      client = httpRequest(options, (response) => {
        answered.resolve({ ok: true, response });
      });
    }
    const connectTimer = setTimeout(() => {
      client.destroy(Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }));
    }, connectTimeoutMs);
    client.once("socket", (socket) => {
      socket.once(hop.url.protocol === "https:" ? "secureConnect" : "connect", () => {
        clearTimeout(connectTimer);
      });
    });
    client.once("response", () => {
      clearTimeout(connectTimer);
    });
    client.once("error", (error) => {
      clearTimeout(connectTimer);
      answered.resolve({ failure: failureOfError(error), ok: false });
    });
    client.end();
    return await answered.promise;
  };

  const fetchOnce = async (request: FetchRequest, signal: AbortSignal): Promise<FetchResult> => {
    let hop = hopOf(request.url);
    let { reach } = request;
    for (let redirects = 0; hop !== null; redirects += 1) {
      const vetted = await vetHop(hop, reach);
      if (!vetted.ok) {
        return vetted;
      }
      ({ reach } = vetted);
      const answered = await send(hop, vetted.addresses, request, signal);
      if (!answered.ok) {
        return answered;
      }
      const { response } = answered;
      const status = response.statusCode ?? 0;
      const { location } = response.headers;
      if (REDIRECT_STATUSES.has(status) && location !== undefined) {
        response.destroy();
        if (redirects >= MAX_REDIRECTS) {
          return { failure: { kind: "redirects" }, ok: false };
        }
        hop = hopOf(location, hop.url);
        continue;
      }
      if (status >= 400 || status < 200) {
        response.destroy();
        return {
          failure: {
            kind: "status",
            reason: (STATUS_CODES[status] ?? "an error").toLowerCase(),
            status,
            transient: TRANSIENT_STATUSES.has(status),
          },
          ok: false,
        };
      }
      const declaredHeader = response.headers["content-length"];
      const declared = declaredHeader === undefined ? null : Number(declaredHeader);
      if (
        request.overflow === "refuse" &&
        declared !== null &&
        Number.isFinite(declared) &&
        declared > request.maxBytes
      ) {
        response.destroy();
        return { failure: { bytes: declared, kind: "too-large" }, ok: false };
      }
      const body = await readBody(response, request, declared);
      if (!body.ok) {
        return body;
      }
      const type = parseContentType(response.headers["content-type"]);
      return {
        ok: true,
        response: {
          bytes: body.bytes,
          charset: type.charset,
          mediaType: type.mediaType,
          reach,
          status,
          truncated: body.truncated,
          url: hop.url.href,
        },
      };
    }
    return { failure: { kind: "unreachable", transient: false }, ok: false };
  };

  return {
    async fetch(request) {
      const deadline = AbortSignal.timeout(requestTimeoutMs);
      const signal =
        request.signal === undefined ? deadline : AbortSignal.any([deadline, request.signal]);
      const result = await fetchOnce(request, signal);
      if (result.ok || !signal.aborted) {
        return result;
      }
      return {
        failure: deadline.aborted ? { kind: "timeout" } : { kind: "aborted" },
        ok: false,
      };
    },

    async reachOf(url, signal) {
      const hop = hopOf(url);
      if (hop === null) {
        return { failure: { kind: "unreachable", transient: false }, ok: false };
      }
      if (signal?.aborted === true) {
        return { failure: { kind: "aborted" }, ok: false };
      }
      const vetted = await vetHop(hop, null);
      return vetted.ok ? { ok: true, reach: vetted.reach } : vetted;
    },
  };
};
