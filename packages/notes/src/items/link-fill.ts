// What any device that reads a saved link judges by: how much of a page it reads, which of its
// pictures is a cover, whether an answer is a page, a video or a sound at all, which of a page's
// texts it reads for, and whether a reading is kept. The cloud's fill
// (apps/web/src/worker/fill/read-page.ts) and the extension each read by these, so a link reads the
// same whichever read it.

import { kindForUrl } from "./item-url";
import { pixelSize, sniffMedia } from "./sniff-media";
import type { PixelSize } from "./sniff-media";

const MiB = 1024 * 1024;

// what every device that fills a link reads of it: a page's answer up to 10 MiB (a file at the link
// past it keeps only its link), its first 5 MiB read as the page, and of that page's readable part
// the leading 192 KiB of markup, cut between whole blocks, as its article (the reading costs time
// and heap by that markup's length: five seconds within a Worker isolate's heap at the budget, and
// two and a half minutes and 1.5 GB for 5 MiB, measured by
// packages/page-reader/src/extract-page.heap.test.ts); a cover candidate up to 10 MiB, and one under
// 200 px is a pixel or an icon, never a cover. A cover is kept as the site served it, within
// coverBytes, and each device draws its own thumbnail from it, rather than the cloud shrinking it
// with a wasm decoder: a decoded picture is four bytes a pixel (48 MB for 4000 x 3000) in an
// isolate whose heap the reading already uses. So no cover is kept or drawn past coverMaxPixels,
// whatever the file's size, since a few bytes can name a bitmap of gigabytes; the cap clears the
// 48-megapixel photo an iPhone takes
export const FILL_LIMITS = {
  articleBytes: 192 * 1024,
  coverBytes: 10 * MiB,
  coverMaxPixels: 50_000_000,
  coverMinEdge: 200,
  htmlBytes: 5 * MiB,
  pageBytes: 10 * MiB,
} as const;

// whether a device may decode a picture of this size
export const decodable = ({ height, width }: PixelSize): boolean =>
  width * height <= FILL_LIMITS.coverMaxPixels;

// a fetched cover candidate as a page's cover: the picture its bytes are, unless its header names
// a pixel, an icon or more than a device may decode; the cloud's fill and the extension, which keep
// a cover as the site served it, judge every candidate by this
export const coverPicture = (bytes: Uint8Array): { readonly mime: string } | null => {
  const sniffed = sniffMedia(bytes);
  if (sniffed?.kind !== "image") {
    return null;
  }
  const size = pixelSize(bytes, sniffed.mediaType);
  return size !== null &&
    (Math.max(size.width, size.height) < FILL_LIMITS.coverMinEdge || !decodable(size))
    ? null
    : { mime: sniffed.mediaType };
};

// whether an answer is a page the reader reads: a file says so in its first bytes, whatever it was
// served as, and otherwise the type it declared decides (none reads as one)
export const isPage = (answer: {
  readonly bytes: Uint8Array;
  readonly mediaType: string | null;
}): boolean =>
  sniffMedia(answer.bytes) === null &&
  (answer.mediaType === null ||
    answer.mediaType === "text/html" ||
    answer.mediaType === "application/xhtml+xml");

// a link that answered with a video or a sound is kept as its link, read as that kind
export const playableKindOf = (mediaType: string | null): "video" | "audio" | null => {
  if (mediaType?.startsWith("video/") === true) {
    return "video";
  }
  return mediaType?.startsWith("audio/") === true ? "audio" : null;
};

// which of a page's texts a reading keeps as its article: a video's or a song's page holds little
// prose, so its description stands for it. It goes by the address the item's kind goes by: a link
// takes the kind of where it landed, and a video or a song stays one wherever it landed
export const preferredText = (saved: string, landed: string = saved): "article" | "description" =>
  kindForUrl(saved) === "link" && kindForUrl(landed) === "link" ? "article" : "description";

// a device has the cloud's fill behind it and an item saved read is never filled, so it keeps only
// an article and hands the page over: the fill can find what a device did not, such as a post an
// app shell hides, which its host's oEmbed holds
export const deviceKeepsReading = (article: readonly unknown[]): boolean => article.length > 0;

// nothing reads after the fill, so it keeps a page that named itself though none of its text settled
export const fillKeepsReading = (read: {
  readonly rung: string | null;
  readonly facts: { readonly title: string | null; readonly description: string | null };
}): boolean => read.rung !== null || read.facts.title !== null || read.facts.description !== null;
