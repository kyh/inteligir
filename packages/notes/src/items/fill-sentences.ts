// why a page was not read, in one plain sentence, as the item says it, and whether the fill tries
// again later: offline, a timeout, a resolver that did not answer, or a site saying it is busy
// (429, 503) leave the link waiting for a retry; anything else is said on the item.

// what a fetch refuses to ask: a saved address whose spelling names private space, a public page's
// redirect into it, or space no host holds
type FetchRefusal = "reserved" | "private-from-public" | "private-network";

export type FetchFailure =
  | { kind: "refused"; refusal: FetchRefusal }
  // `reason` is the platform's own wording of the status, never the site's
  | { kind: "status"; status: number; reason: string; transient: boolean }
  | { kind: "timeout" }
  | { kind: "unreachable"; transient: boolean }
  | { kind: "tls" }
  | { kind: "redirects" }
  // `bytes`: the size the site declared, or what had arrived when the read stopped
  | { kind: "too-large"; bytes: number }
  | { kind: "aborted" };

// the standard's own wording of a refused status, never the site's, which is its own to say
const STATUS_REASONS: ReadonlyMap<number, string> = new Map([
  [100, "continue"],
  [101, "switching protocols"],
  [102, "processing"],
  [103, "early hints"],
  [400, "bad request"],
  [401, "unauthorized"],
  [402, "payment required"],
  [403, "forbidden"],
  [404, "not found"],
  [405, "method not allowed"],
  [406, "not acceptable"],
  [407, "proxy authentication required"],
  [408, "request timeout"],
  [409, "conflict"],
  [410, "gone"],
  [411, "length required"],
  [412, "precondition failed"],
  [413, "payload too large"],
  [414, "uri too long"],
  [415, "unsupported media type"],
  [416, "range not satisfiable"],
  [417, "expectation failed"],
  [418, "i'm a teapot"],
  [421, "misdirected request"],
  [422, "unprocessable entity"],
  [423, "locked"],
  [424, "failed dependency"],
  [425, "too early"],
  [426, "upgrade required"],
  [428, "precondition required"],
  [429, "too many requests"],
  [431, "request header fields too large"],
  [451, "unavailable for legal reasons"],
  [500, "internal server error"],
  [501, "not implemented"],
  [502, "bad gateway"],
  [503, "service unavailable"],
  [504, "gateway timeout"],
  [505, "http version not supported"],
  [506, "variant also negotiates"],
  [507, "insufficient storage"],
  [508, "loop detected"],
  [509, "bandwidth limit exceeded"],
  [510, "not extended"],
  [511, "network authentication required"],
]);

// a site saying it is busy, which a later try may get past
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 503]);

// a status no page is read from (anything outside 200 to 299), as every device says it
export const statusFailure = (status: number): FetchFailure => ({
  kind: "status",
  reason: STATUS_REASONS.get(status) ?? "an error",
  status,
  transient: TRANSIENT_STATUSES.has(status),
});

interface FillFailure {
  sentence: string;
  transient: boolean;
}

export const TEXT_NOT_SAVED = "The page's text couldn't be saved.";
const MB = 1024 * 1024;

const LIMIT_MB = 10;

// MB to the nearest whole; a size the read only knows is past the limit (the site declared none, or
// one that rounds to the limit) is said as over it
export const fileOnlyLinked = (bytes: number | null): string => {
  const mb = bytes === null ? null : Math.max(1, Math.round(bytes / MB));
  return mb === null || mb <= LIMIT_MB
    ? `The file is over ${String(LIMIT_MB)} MB; only its link is kept.`
    : `The file is ${String(mb)} MB; only its link is kept (the limit is ${String(LIMIT_MB)} MB).`;
};

export const failureOf = (failure: FetchFailure): FillFailure => {
  switch (failure.kind) {
    case "refused": {
      switch (failure.refusal) {
        case "private-from-public": {
          return {
            sentence: "The page pointed at an address on your own network, so it isn't read.",
            transient: false,
          };
        }
        case "private-network": {
          return {
            sentence:
              "This address is on a private network, which the cloud can't reach, so its page isn't read.",
            transient: false,
          };
        }
        case "reserved": {
          return { sentence: "This address isn't one a page can be read from.", transient: false };
        }
        default: {
          const exhaustive: never = failure.refusal;
          return exhaustive;
        }
      }
    }
    case "status": {
      return {
        sentence: `The site answered ${String(failure.status)} (${failure.reason}).`,
        transient: failure.transient,
      };
    }
    case "timeout": {
      return { sentence: "The page took too long to answer.", transient: true };
    }
    case "unreachable": {
      return { sentence: "The page couldn't be reached.", transient: failure.transient };
    }
    case "tls": {
      return { sentence: "The site's certificate isn't trusted.", transient: false };
    }
    case "redirects": {
      return { sentence: "The page redirected too many times.", transient: false };
    }
    case "too-large": {
      return { sentence: fileOnlyLinked(failure.bytes), transient: false };
    }
    case "aborted": {
      return { sentence: "The page couldn't be reached.", transient: true };
    }
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
};
