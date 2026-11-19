import { kindForUrl } from "./item-url";
import { pixelSize, sniffMedia } from "./sniff-media";
import type { PixelSize } from "./sniff-media";

const MiB = 1024 * 1024;

export const FILL_LIMITS = {
  articleBytes: 192 * 1024,
  coverBytes: 10 * MiB,
  coverMaxPixels: 50_000_000,
  coverMinEdge: 200,
  htmlBytes: 5 * MiB,
  pageBytes: 10 * MiB,
} as const;

export const decodable = ({ height, width }: PixelSize) =>
  width * height <= FILL_LIMITS.coverMaxPixels;

export const coverPicture = (bytes: Uint8Array) => {
  const sniffed = sniffMedia(bytes);

  if (sniffed?.kind !== "image") {
    return null;
  }

  const size = pixelSize(bytes, sniffed.mediaType);

  return (
    size !== null &&
    (Math.max(size.width, size.height) < FILL_LIMITS.coverMinEdge || !decodable(size))
      ? null
      : { mime: sniffed.mediaType }
  ) satisfies { readonly mime: string } | null;
};

export const isPage = (answer: { readonly bytes: Uint8Array; readonly mediaType: string | null }) =>
  sniffMedia(answer.bytes) === null &&
  (answer.mediaType === null ||
    answer.mediaType === "text/html" ||
    answer.mediaType === "application/xhtml+xml");

export const playableKindOf = (mediaType: string | null) => {
  if (mediaType?.startsWith("video/") === true) {
    return "video" as const;
  }

  return (mediaType?.startsWith("audio/") === true ? "audio" : null) satisfies
    | "video"
    | "audio"
    | null;
};

export const preferredText = (saved: string, landed: string = saved) =>
  (kindForUrl(saved) === "link" && kindForUrl(landed) === "link"
    ? "article"
    : "description") satisfies "article" | "description";

export const deviceKeepsReading = (article: readonly unknown[]) => article.length > 0;

export const fillKeepsReading = (read: {
  readonly rung: string | null;
  readonly facts: { readonly title: string | null; readonly description: string | null };
}) => read.rung !== null || read.facts.title !== null || read.facts.description !== null;
