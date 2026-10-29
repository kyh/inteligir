// a media host's oEmbed answer, asked through the guard: the endpoint and the reading are
// @repo/notes/items/oembed's, the same on every device that fills, and the thumbnail is one more
// cover candidate through the same guard.

import { OEMBED_MAX_BYTES, oembedEndpoint, parseOEmbed } from "@repo/notes/items/oembed";
import type { OEmbed } from "@repo/notes/items/oembed";

import type { Reach } from "./address-guard";
import type { GuardedFetch } from "./guarded-fetch";

export const fetchOEmbed = async (args: {
  url: string;
  // the page's discovery link, the fallback for a host without a known endpoint
  discovered: string | null;
  reach: Reach;
  fetcher: GuardedFetch;
  signal: AbortSignal;
}): Promise<OEmbed | null> => {
  const endpoint = oembedEndpoint(args.url, args.discovered);
  if (endpoint === null) {
    return null;
  }
  const fetched = await args.fetcher.fetch({
    accept: "application/json",
    maxBytes: OEMBED_MAX_BYTES,
    overflow: "refuse",
    reach: args.reach,
    signal: args.signal,
    url: endpoint,
  });
  return fetched.ok ? parseOEmbed(fetched.response.bytes) : null;
};
