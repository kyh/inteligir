// What any device that reads a saved link judges by: how much of a page it reads, which of its
// pictures is a cover, and whether an answer is a page, a video or a sound at all. The cloud's fill
// (apps/web/src/worker/fill/read-page.ts), the extension and the phone's share each read by these,
// so a link reads the same whichever device read it.

import { pixelSize, sniffMedia } from "./sniff-media";

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
// isolate whose heap the reading already uses
export const FILL_LIMITS = {
  articleBytes: 192 * 1024,
  coverBytes: 10 * MiB,
  coverMinEdge: 200,
  htmlBytes: 5 * MiB,
  pageBytes: 10 * MiB,
} as const;

// a fetched cover candidate as a page's cover: the picture its bytes are, unless its header names
// a pixel or an icon by its size; the cloud's fill and the extension, which keep a cover as the
// site served it, judge every candidate by this
export const coverPicture = (bytes: Uint8Array): { readonly mime: string } | null => {
  const sniffed = sniffMedia(bytes);
  if (sniffed?.kind !== "image") {
    return null;
  }
  const size = pixelSize(bytes, sniffed.mediaType);
  return size !== null && Math.max(size.width, size.height) < FILL_LIMITS.coverMinEdge
    ? null
    : { mime: sniffed.mediaType };
};

// whether an answer is a page the reader reads, by the type it declared (none reads as one)
export const isPageType = (mediaType: string | null): boolean =>
  mediaType === null || mediaType === "text/html" || mediaType === "application/xhtml+xml";

// a link that answered with a video or a sound is kept as its link, read as that kind
export const playableKindOf = (mediaType: string | null): "video" | "audio" | null => {
  if (mediaType?.startsWith("video/") === true) {
    return "video";
  }
  return mediaType?.startsWith("audio/") === true ? "audio" : null;
};
