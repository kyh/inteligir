// How the cloud reads a page it fills: the Workers runtime's own fetch, every hop of it judged before
// it is asked. Only http and https on their own ports, as a page is served; never a host whose
// spelling names a place off the public internet: this machine or a name no public resolver
// answers (`@repo/contract/items/host-names`), or an address written out in private or reserved space
// (`./address-space`), since the platform reaches a host by its name alone
// (https://developers.cloudflare.com/workers/platform/known-issues/) and from the public internet
// (`global_fetch_strictly_public`, so even this Worker's own zone is asked through its front door);
// a public address written out is asked like any name. Redirects and the byte cap are every host's
// (`@repo/service/items/page-fetch`); no cookie or credential is sent, and the whole read has a
// deadline (20 s). A refusal is said in the fill's own words (`@repo/service/items/fill-sentences`).

import type { FetchFailure } from "../items/fill-sentences";
import { isLoopbackName, isPrivateUseName } from "@repo/contract/items/host-names";
import { followRedirects } from "../items/page-fetch";
import type { PageFetchResult, PageHop, PageRequest } from "../items/page-fetch";

import { addressSpace } from "./address-space";
import type { AddressSpace } from "./address-space";

export type PageFetch = (request: PageRequest) => Promise<PageFetchResult>;

// how long a whole read may take, its redirects and its body included
const DEADLINE_MS = 20_000;
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
const hopOf = (raw: string, from: string | null): PageHop => {
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

// the guarded fetch, its whole read held to `deadlineMs`
/** @internal */
export const pageFetch =
  (options: { readonly deadlineMs: number }): PageFetch =>
  async (request) => {
    const first = hopOf(request.url, null);
    if ("refused" in first) {
      return { failure: first.refused, ok: false };
    }
    const signal = AbortSignal.timeout(options.deadlineMs);
    try {
      return await followRedirects({
        ask: async (url) =>
          await fetch(url, {
            headers: { accept: request.accept, ...HEADERS },
            redirect: "manual",
            signal,
          }),
        first: first.url,
        hop: hopOf,
        request,
      });
    } catch {
      // a name that did not resolve, a connection cut, the read past its time: a later try may pass
      return {
        failure: signal.aborted ? { kind: "timeout" } : { kind: "unreachable", transient: true },
        ok: false,
      };
    }
  };

export const fetchPage: PageFetch = pageFetch({ deadlineMs: DEADLINE_MS });
