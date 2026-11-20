import { STATUS_CODES } from "node:http";

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

const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export const statusFailure = (status: number) =>
  ({
    kind: "status",
    reason: STATUS_CODES[status]?.toLowerCase() ?? "an error",
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
