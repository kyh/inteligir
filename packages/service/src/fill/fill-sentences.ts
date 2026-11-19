export type FetchRefusal =
  | "off-web"
  | "address-literal"
  | "private-from-public"
  | "private-network";

export type FetchFailure =
  | { kind: "refused"; refusal: FetchRefusal }
  | { kind: "status"; status: number; reason: string; transient: boolean }
  | { kind: "timeout" }
  | { kind: "unreachable" }
  | { kind: "redirects" }
  | { kind: "too-large"; bytes: number };

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

const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export const statusFailure = (status: number) =>
  ({
    kind: "status",
    reason: STATUS_REASONS.get(status) ?? "an error",
    status,
    transient: TRANSIENT_STATUSES.has(status),
  }) satisfies FetchFailure;

interface FillFailure {
  sentence: string;
  transient: boolean;
}

export const TEXT_NOT_SAVED = "The page's text couldn't be saved.";
export const PAGE_UNREACHED = "The page couldn't be reached.";
const MB = 1024 * 1024;

const LIMIT_MB = 10;

export const fileOnlyLinked = (bytes: number | null) => {
  const mb = bytes === null ? null : Math.max(1, Math.round(bytes / MB));

  return mb === null || mb <= LIMIT_MB
    ? `The file is over ${String(LIMIT_MB)} MB; only its link is kept.`
    : `The file is ${String(mb)} MB; only its link is kept (the limit is ${String(LIMIT_MB)} MB).`;
};

export const failureOf = (failure: FetchFailure) => {
  switch (failure.kind) {
    case "refused": {
      switch (failure.refusal) {
        case "private-from-public": {
          return {
            sentence: "The page pointed at an address on your own network, so it isn't read.",
            transient: false,
          } satisfies FillFailure;
        }

        case "private-network": {
          return {
            sentence:
              "This address is on a private network, which the cloud can't reach, so its page isn't read.",
            transient: false,
          } satisfies FillFailure;
        }

        case "address-literal": {
          return {
            sentence: "The cloud opens pages by name, so an address written as numbers isn't read.",
            transient: false,
          } satisfies FillFailure;
        }

        case "off-web": {
          return {
            sentence: "This address isn't one a page can be read from.",
            transient: false,
          } satisfies FillFailure;
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
      } satisfies FillFailure;
    }

    case "timeout": {
      return {
        sentence: "The page took too long to answer.",
        transient: true,
      } satisfies FillFailure;
    }

    case "unreachable": {
      return { sentence: PAGE_UNREACHED, transient: true } satisfies FillFailure;
    }

    case "redirects": {
      return {
        sentence: "The page redirected too many times.",
        transient: false,
      } satisfies FillFailure;
    }

    case "too-large": {
      return { sentence: fileOnlyLinked(failure.bytes), transient: false } satisfies FillFailure;
    }

    default: {
      const exhaustive: never = failure;

      return exhaustive;
    }
  }
};
