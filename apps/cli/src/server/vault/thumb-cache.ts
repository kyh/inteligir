// The grid's thumbnails, kept in the data dir rather than the library: a downscaled copy is this
// Mac's cache, never an item's file, so it is not synced, not in history and not listed. The
// cache is bounded: a hit touches the file, and the oldest touched go first once the folder holds
// more than THUMB_CACHE_MAX_BYTES, checked when the cache first opens and after every
// PRUNE_EVERY_WRITES writes.

import { createHash, randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { errnoCode } from "../errno";

export const THUMB_CACHE_MAX_BYTES = 256 * 1024 * 1024;

const PRUNE_EVERY_WRITES = 100;

const THUMB_TYPES = {
  gif: "image/gif",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
} as const;

type ThumbExtension = keyof typeof THUMB_TYPES;

export type ThumbMediaType = (typeof THUMB_TYPES)[ThumbExtension];

export interface Thumb {
  bytes: Uint8Array;
  mediaType: ThumbMediaType;
}

// what one make of a key answers: the cached thumbnail it wrote, the original to serve in its
// place, or nothing the grid can show
export type ThumbAnswer =
  | { kind: "thumb"; thumb: Thumb }
  | { kind: "original"; bytes: Uint8Array; mediaType: string }
  | { kind: "none" };

const isThumbExtension = (value: string): value is ThumbExtension =>
  Object.hasOwn(THUMB_TYPES, value);

const extensionOf = (mediaType: ThumbMediaType): ThumbExtension => {
  for (const extension of Object.keys(THUMB_TYPES)) {
    if (isThumbExtension(extension) && THUMB_TYPES[extension] === mediaType) {
      return extension;
    }
  }
  return "jpg";
};

// one key per version of a file at one width: a write or a move of the original is a new key, and
// the stale one ages out
export const thumbKey = (filePath: string, size: number, mtimeMs: number, width: number): string =>
  createHash("sha256")
    .update(`${filePath}|${String(size)}|${String(Math.trunc(mtimeMs))}|${String(width)}`)
    .digest("hex")
    .slice(0, 32);

const KEY_FILE = /^(?<key>[0-9a-f]{32})\.(?<extension>[a-z]+)$/u;

interface CachedThumb {
  file: string;
  mediaType: ThumbMediaType;
  size: number;
  mtimeMs: number;
}

export interface ThumbCache {
  // the cached thumbnail for this key, touched so it outlives the ones nobody asks for
  read: (key: string) => Promise<Thumb | null>;
  write: (key: string, thumb: Thumb) => Promise<void>;
  // every caller asking for one key while it is being made waits on that one make
  shared: (key: string, make: () => Promise<ThumbAnswer>) => Promise<ThumbAnswer>;
  // down to the cap, oldest touched first
  prune: () => Promise<void>;
}

const isGone = (cause: unknown): boolean => {
  const code = errnoCode(cause);
  return code === "ENOENT" || code === "ENOTDIR";
};

const namesIn = async (dir: string): Promise<string[]> => {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isGone(error)) {
      return [];
    }
    throw error;
  }
};

const statOrNull = async (file: string): Promise<Stats | null> => {
  try {
    return await stat(file);
  } catch {
    return null;
  }
};

const unlinkIfThere = async (file: string): Promise<void> => {
  try {
    await unlink(file);
  } catch (error) {
    if (!isGone(error)) {
      throw error;
    }
  }
};

const writeStaged = async (dir: string, file: string, bytes: Uint8Array): Promise<void> => {
  const staged = path.join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    const handle = await open(staged, "w");
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await rename(staged, file);
  } catch (error) {
    await unlinkIfThere(staged);
    throw error;
  }
};

export const createThumbCache = (dir: string, maxBytes = THUMB_CACHE_MAX_BYTES): ThumbCache => {
  const index = new Map<string, CachedThumb>();
  const making = new Map<string, Promise<ThumbAnswer>>();
  let writes = 0;
  let pruning: Promise<void> | null = null;

  const prune = async (): Promise<void> => {
    const entries = [...index.entries()].toSorted(([, a], [, b]) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((sum, [, entry]) => sum + entry.size, 0);
    for (const [key, entry] of entries) {
      if (total <= maxBytes) {
        return;
      }
      await unlinkIfThere(entry.file);
      index.delete(key);
      total -= entry.size;
    }
  };

  const pruneOnce = async (): Promise<void> => {
    pruning ??= (async () => {
      try {
        await prune();
      } finally {
        pruning = null;
      }
    })();
    await pruning;
  };

  // the folder as the last process left it: every file the cache could have written, then the
  // first prune
  const scan = async (): Promise<void> => {
    for (const name of await namesIn(dir)) {
      const match = KEY_FILE.exec(name);
      const key = match?.groups?.key;
      const extension = match?.groups?.extension ?? "";
      if (key === undefined || !isThumbExtension(extension)) {
        continue;
      }
      const file = path.join(dir, name);
      const stats = await statOrNull(file);
      if (stats?.isFile() === true) {
        index.set(key, {
          file,
          mediaType: THUMB_TYPES[extension],
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        });
      }
    }
    await pruneOnce();
  };

  // a scan that failed is tried again by the next caller
  let opened: Promise<void> | null = null;
  const ready = async (): Promise<void> => {
    const opening = opened ?? scan();
    opened = opening;
    try {
      await opening;
    } catch (error) {
      opened = null;
      throw error;
    }
  };

  return {
    async prune() {
      await ready();
      await pruneOnce();
    },
    async read(key) {
      await ready();
      const entry = index.get(key);
      if (entry === undefined) {
        return null;
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(entry.file);
      } catch (error) {
        if (isGone(error)) {
          index.delete(key);
          return null;
        }
        throw error;
      }
      const now = new Date();
      // the touch is what keeps a thumbnail the grid still shows; one that fails costs only that
      try {
        await utimes(entry.file, now, now);
        entry.mtimeMs = now.getTime();
      } catch {
        // See above.
      }
      return { bytes: new Uint8Array(bytes), mediaType: entry.mediaType };
    },
    async shared(key, make) {
      const inflight = making.get(key);
      if (inflight !== undefined) {
        return await inflight;
      }
      const run = make();
      making.set(key, run);
      try {
        return await run;
      } finally {
        making.delete(key);
      }
    },
    async write(key, thumb) {
      await ready();
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${key}.${extensionOf(thumb.mediaType)}`);
      await writeStaged(dir, file, thumb.bytes);
      index.set(key, {
        file,
        mediaType: thumb.mediaType,
        mtimeMs: Date.now(),
        size: thumb.bytes.byteLength,
      });
      writes += 1;
      if (writes % PRUNE_EVERY_WRITES === 0) {
        await pruneOnce();
      }
    },
  };
};

// one cache per data dir for the process's life: the route is handed its deps per request, and
// the index, the count of writes and the makes in flight must outlive any one of them
const caches = new Map<string, ThumbCache>();

export const thumbCacheFor = (dataDir: string): ThumbCache => {
  const dir = path.join(dataDir, "thumbs");
  const known = caches.get(dir);
  if (known !== undefined) {
    return known;
  }
  const cache = createThumbCache(dir);
  caches.set(dir, cache);
  return cache;
};
