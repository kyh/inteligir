// A card's cover, from the phone's own files: the original as the attachment cache holds it (named
// by its blob, so it is fetched once), and for a big one a small JPEG made from it once and kept
// beside it, so a long library scrolls without decoding a page's full-size image per row. Covers
// render from file://, so nothing remote ever loads. At most four covers are fetched or shrunk at
// once, so a fast scroll queues rather than fanning out. Platform-free: expo-cover-thumbs.ts is the
// app's port.

import { basenamePath, extnamePath } from "@repo/notes/knowledge/vault-path";

export type HeldOriginal = { ok: true; uri: string } | { ok: false; message: string };

export interface CoverThumbPort {
  // the original's file on this phone, downloaded on its first ask (the notes store's
  // attachmentFile)
  original: (path: string) => Promise<HeldOriginal>;
  // a held file's size in bytes
  size: (uri: string) => Promise<number>;
  // a thumbnail already made under `name` beside the originals, or null
  find: (name: string) => Promise<string | null>;
  // makes `name` beside the originals, a JPEG `width` px wide drawn from `uri`, and answers its uri
  shrink: (uri: string, name: string, width: number) => Promise<string>;
}

export interface CoverThumbs {
  // the file a card draws; null while the cover is not on this phone (offline, or never fetched),
  // which the card shows as a placeholder
  thumbFor: (path: string) => Promise<string | null>;
}

// an original at or under this is drawn as it is
export const THUMB_MIN_BYTES = 512 * 1024;
export const THUMB_WIDTH = 320;
const THUMB_CONCURRENCY = 4;

// `<oid>.thumb.jpg`, named by the original's own cache name, so a new cover is a new thumbnail
export const thumbNameOf = (uri: string): string => {
  const name = basenamePath(uri);
  return `${name.slice(0, name.length - extnamePath(name).length)}.thumb.jpg`;
};

// runs at most `width` jobs at once, the rest in the order they were asked; a finished job hands
// its slot straight to the next, so no caller slips in between
const limiter = (width: number) => {
  let running = 0;
  const waiting: (() => void)[] = [];
  const acquire = async (): Promise<void> => {
    if (running < width) {
      running += 1;
      return;
    }
    // oxlint-disable-next-line promise/avoid-new -- a queued job waits for the slot a finished one hands over
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  };
  const release = (): void => {
    const handOver = waiting.shift();
    if (handOver === undefined) {
      running -= 1;
    } else {
      handOver();
    }
  };
  return async <T>(job: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await job();
    } finally {
      release();
    }
  };
};

export const createCoverThumbs = (port: CoverThumbPort): CoverThumbs => {
  const limit = limiter(THUMB_CONCURRENCY);
  // one job per cover while it runs, so every row asking for one cover shares it
  const running = new Map<string, Promise<string | null>>();

  const thumbOf = async (path: string): Promise<string | null> => {
    const original = await port.original(path);
    if (!original.ok) {
      return null;
    }
    let size: number;
    try {
      size = await port.size(original.uri);
    } catch {
      return null;
    }
    if (size <= THUMB_MIN_BYTES) {
      return original.uri;
    }
    const name = thumbNameOf(original.uri);
    const made = await port.find(name);
    if (made !== null) {
      return made;
    }
    try {
      return await port.shrink(original.uri, name, THUMB_WIDTH);
    } catch {
      // an image the phone cannot decode still draws as itself
      return original.uri;
    }
  };

  return {
    async thumbFor(path) {
      const held = running.get(path);
      if (held !== undefined) {
        return await held;
      }
      const job = (async (): Promise<string | null> => {
        try {
          return await limit(async () => await thumbOf(path));
        } catch {
          return null;
        } finally {
          running.delete(path);
        }
      })();
      running.set(path, job);
      return await job;
    },
  };
};
