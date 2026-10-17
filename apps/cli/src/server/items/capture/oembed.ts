// a media host's own oEmbed answer: YouTube, Vimeo, TikTok, Spotify, SoundCloud and X (asked with
// `dnt=true`), or the page's own discovery link. The answer is JSON from a site and so hostile:
// at most 256 KiB, parsed by a schema, every string clipped, and its thumbnail one more cover
// candidate through the same guard.

import { z } from "zod";

import { urlHost } from "@repo/notes/items/item-url";

import type { Reach } from "./address-guard";
import type { GuardedFetch } from "./guarded-fetch";

export interface OEmbed {
  title: string | null;
  author: string | null;
  provider: string | null;
  thumbnail: string | null;
  // the provider's markup (X's tweet text rides in it); read as a page, never rendered
  html: string | null;
}

const OEMBED_MAX_BYTES = 256 * 1024;

// a string clipped to `max`, and anything else (a number, a list, null) as absent
const clipped = (max: number) =>
  z.unknown().transform((value) => {
    const text = z.string().safeParse(value);
    return text.success ? text.data.trim().slice(0, max) : null;
  });

const oembedSchema = z.looseObject({
  author_name: clipped(200),
  html: clipped(64 * 1024),
  provider_name: clipped(200),
  thumbnail_url: clipped(8192),
  title: clipped(2000),
});

const encoded = (url: string): string => encodeURIComponent(url);

// the provider's own endpoint for a url on its host, by the host after aliasing
const providerEndpoint = (url: string): string | null => {
  const host = urlHost(url) ?? "";
  const on = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
  if (on("youtube.com") || host === "youtu.be") {
    return `https://www.youtube.com/oembed?format=json&url=${encoded(url)}`;
  }
  if (on("vimeo.com")) {
    return `https://vimeo.com/api/oembed.json?url=${encoded(url)}`;
  }
  if (on("tiktok.com")) {
    return `https://www.tiktok.com/oembed?url=${encoded(url)}`;
  }
  if (host === "open.spotify.com") {
    return `https://open.spotify.com/oembed?url=${encoded(url)}`;
  }
  if (on("soundcloud.com")) {
    return `https://soundcloud.com/oembed?format=json&url=${encoded(url)}`;
  }
  if (on("twitter.com") || on("x.com")) {
    return `https://publish.twitter.com/oembed?dnt=true&omit_script=true&url=${encoded(url)}`;
  }
  return null;
};

const webOrNull = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && /^https?:\/\//iu.test(value) ? value : null;

const orNull = (value: string | null | undefined): string | null =>
  value === undefined || value === null || value === "" ? null : value;

export const fetchOEmbed = async (args: {
  url: string;
  // the page's discovery link, the fallback for a host without a known endpoint
  discovered: string | null;
  reach: Reach;
  fetcher: GuardedFetch;
  signal: AbortSignal;
}): Promise<OEmbed | null> => {
  const endpoint = providerEndpoint(args.url) ?? args.discovered;
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
  if (!fetched.ok) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(fetched.response.bytes));
  } catch {
    return null;
  }
  const parsed = oembedSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  return {
    author: orNull(parsed.data.author_name),
    html: orNull(parsed.data.html),
    provider: orNull(parsed.data.provider_name),
    thumbnail: webOrNull(parsed.data.thumbnail_url),
    title: orNull(parsed.data.title),
  };
};

const YOUTUBE_ID = /^[\w-]{6,20}$/u;

// a YouTube video's own still frames, the last candidates before a cover hint
export const youTubeStills = (url: string): string[] => {
  const host = urlHost(url) ?? "";
  let id: string | null = null;
  try {
    const parsed = new URL(url);
    if (host === "youtu.be") {
      id = parsed.pathname.slice(1).split("/")[0] ?? null;
    } else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      id =
        parsed.searchParams.get("v") ??
        /^\/(?:shorts|live|embed)\/(?<id>[^/?#]+)/u.exec(parsed.pathname)?.groups?.id ??
        null;
    }
  } catch {
    return [];
  }
  if (id === null || !YOUTUBE_ID.test(id)) {
    return [];
  }
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ];
};
