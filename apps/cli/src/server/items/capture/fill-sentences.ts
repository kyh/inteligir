// why a page was not read, in one plain sentence, as the item's `fetch-error` says it, and whether
// the fill tries again later: offline, a timeout, a resolver that did not answer, or a site saying
// it is busy (429, 503) leave the stub as it is for a retry; anything else is said in the file.

import type { FetchFailure } from "./guarded-fetch";

export interface FillFailure {
  sentence: string;
  transient: boolean;
}

export const TEXT_NOT_SAVED = "The page's text couldn't be saved.";
export const COPY_TOO_BIG = "The page is too big to keep a copy of; its text is saved.";

const MB = 1024 * 1024;

const LIMIT_MB = 10;

// MB to the nearest whole, as fileTooLargeMessage says it; a size the read only knows is past the
// limit (the site declared none, or one that rounds to the limit) is said as over it
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
        case "this-mac": {
          return {
            sentence: "This address is on this Mac, so its page isn't read.",
            transient: false,
          };
        }
        case "link-local": {
          return {
            sentence: "This address is on this network's own hardware, so its page isn't read.",
            transient: false,
          };
        }
        case "private-from-public": {
          return {
            sentence: "The page pointed at an address on your own network, so it isn't read.",
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
