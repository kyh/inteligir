// How the phone reads a link it is shared: the platform's fetch (Expo's streams its body), at most
// 20 s, with no cookie or credential sent, its redirects and byte cap every host's
// (`@repo/notes/items/page-fetch`). A public page is read over https alone, since iOS's App
// Transport Security allows plain http only to an address, a one-label name or `.local`. A fetch
// reaches a host by its name alone, so every step is judged by its spelling (`namesPrivateSpace`):
// a step into private space needs the address it came from to name private space too, so a public
// page closes it for the rest of the walk, however the walk began. A page not read is saved as its
// link for the cloud to read, whatever stopped it, so a refusal carries no reason here.
// Platform-free: the suites hand it node's fetch.

import { namesPrivateSpace } from "@repo/notes/items/host-names";
import { isWebUrl } from "@repo/notes/items/item-url";
import { followRedirects } from "@repo/notes/items/page-fetch";
import type { FetchedPage, PageHop, PageRequest } from "@repo/notes/items/page-fetch";

// the fetch the phone's runtime installs, typed as far as this reads it
export type PlatformFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface PhonePageRequest extends PageRequest {
  // the address that led here: the page that named a cover, and a shared page's own, since where
  // a walk begins is the person's to say
  readonly from: string;
}

type PhonePage = Pick<FetchedPage, "bytes" | "charset" | "mediaType" | "url">;

export type PageFetch = (
  request: PhonePageRequest,
) => Promise<{ readonly ok: true; readonly page: PhonePage } | { readonly ok: false }>;

const REQUEST_TIMEOUT_MS = 20_000;

// the walk says why it stopped, which nothing here reads
const REFUSED: PageHop = { refused: { kind: "refused", refusal: "reserved" } };

// a step the phone takes: on the web, over https to a public address, and into private space only
// from an address there
const asked = (url: string, from: string): boolean => {
  if (!isWebUrl(url)) {
    return false;
  }
  return namesPrivateSpace(url) ? namesPrivateSpace(from) : !/^http:/iu.test(url.trim());
};

// where a redirect leads, resolved against the hop it came from; null for a Location no parser
// reads. The runtime's URL is WHATWG under node and Expo alike
const redirectTarget = (location: string, from: string): string | null => {
  try {
    return new URL(location, from).href;
  } catch {
    return null;
  }
};

export const createPageFetch =
  (
    platformFetch: PlatformFetch,
    headers: { userAgent: string; acceptLanguage: string },
  ): PageFetch =>
  async (request) => {
    if (!asked(request.url, request.from)) {
      return { ok: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      return await followRedirects({
        ask: async (url) =>
          await platformFetch(url, {
            credentials: "omit",
            headers: {
              Accept: request.accept,
              "Accept-Language": headers.acceptLanguage,
              "User-Agent": headers.userAgent,
            },
            redirect: "manual",
            signal: controller.signal,
          }),
        first: request.url,
        hop: (location, from) => {
          const next = redirectTarget(location, from);
          return next !== null && asked(next, from) ? { url: next } : REFUSED;
        },
        request,
      });
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  };
