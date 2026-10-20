// a media host's own oEmbed answer: YouTube, Vimeo, TikTok, Spotify, SoundCloud and X (asked with
// `dnt=true`), or the page's own discovery link. The answer is JSON from a site and so hostile: the
// device that fills reads at most 256 KiB of it, it is parsed by a schema, every string is clipped,
// and its thumbnail is one more cover candidate. The question and the reading are the same on every
// device that fills; each asks through its own fetch.

import { z } from "zod";

import { urlHost, youTubeVideoId } from "./item-url";

export interface OEmbed {
  title: string | null;
  author: string | null;
  provider: string | null;
  thumbnail: string | null;
  // the provider's markup (X's tweet text rides in it); read as a page, never rendered
  html: string | null;
}

export const OEMBED_MAX_BYTES = 256 * 1024;

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

// where a fill asks: the host's own endpoint, else the page's discovery link; null for neither
export const oembedEndpoint = (url: string, discovered: string | null): string | null =>
  providerEndpoint(url) ?? discovered;

const webOrNull = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && /^https?:\/\//iu.test(value) ? value : null;

const orNull = (value: string | null | undefined): string | null =>
  value === undefined || value === null || value === "" ? null : value;

// the answer's bytes read, or null for anything that is not an oEmbed object
export const parseOEmbed = (bytes: Uint8Array): OEmbed | null => {
  let parsed: ReturnType<typeof oembedSchema.safeParse>;
  try {
    parsed = oembedSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
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

// a YouTube video's own still frames, the last candidates before a cover hint
export const youTubeStills = (url: string): string[] => {
  const id = youTubeVideoId(url);
  return id === null
    ? []
    : [
        `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      ];
};
