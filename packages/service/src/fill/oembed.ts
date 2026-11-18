import { z } from "zod";

import { urlHost, youTubeVideoId } from "@repo/contract/items/item-url";

export interface OEmbed {
  title: string | null;
  author: string | null;
  provider: string | null;
  thumbnail: string | null;
  html: string | null;
}

export const OEMBED_MAX_BYTES = 256 * 1024;

const clipped = (max: number) =>
  z
    .unknown()
    .optional()
    .transform((value) => {
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

const encoded = (url: string) => encodeURIComponent(url);

const providerEndpoint = (url: string) => {
  const host = urlHost(url) ?? "";
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);

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

export const oembedEndpoint = (url: string, discovered: string | null) =>
  providerEndpoint(url) ?? discovered;

const webOrNull = (value: string | null | undefined) =>
  value !== null && value !== undefined && /^https?:\/\//iu.test(value) ? value : null;

const orNull = (value: string | null | undefined) =>
  value === undefined || value === null || value === "" ? null : value;

export const parseOEmbed = (bytes: Uint8Array) => {
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
  } satisfies OEmbed | null;
};

export const youTubeStills = (url: string) => {
  const id = youTubeVideoId(url);

  return (
    id === null
      ? []
      : [
          `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        ]
  ) satisfies string[];
};
