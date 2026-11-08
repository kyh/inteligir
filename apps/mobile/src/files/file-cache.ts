// The phone's copy of the library's files: each by its SHA-256 with the type it was sent or served
// as, fetched from the cloud once, the first time a screen draws it, however many screens ask at
// once, into the OS's cache, which iOS may purge, so a purged file is fetched again. A file this
// phone sent is kept as it went, so the phone never downloads what it sent. A card's cover over
// 512 KB draws from a thumbnail made once, in a format that keeps a transparent cover's
// transparency. A cover is drawn whole only when it is a small file whose header names its size;
// one past what a phone may decode, or whose thumbnail could not be made, shows the card's
// placeholder, and is not tried again this session.
//
// Every landing runs under one lock with the sign-in's clear, and checks that no clear came
// between its download and its landing, so a file of an account this phone left never lands
// after the wipe.

import { UNKNOWN_FILE_TYPE } from "@repo/notes/items/item-kind";
import { decodable } from "@repo/notes/items/link-fill";
import { pixelSize, sniffMedia } from "@repo/notes/items/sniff-media";
import { serialLock } from "../lib/serial-lock";

// the one folder the files are kept in, each by its name
export interface FileFolder {
  // the file's address once written
  readonly write: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  // null when the folder holds none by that name
  readonly read: (name: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  readonly uri: (name: string) => Promise<string | null>;
  readonly clear: () => Promise<void>;
}

// a file's bytes and the type it was sent as, or the cloud served it as; a cover's thumbnail too
export interface HeldFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

export interface FileCachePorts {
  readonly folder: FileFolder;
  // the file from the cloud, whole and hash-checked, with the type it serves; null when the cloud
  // holds none
  readonly download: (sha: string) => Promise<HeldFile | null>;
  // a cover drawn at a card's width, or null when it cannot be decoded or is past what a phone may
  // decode, which it measures before it decodes
  readonly shrink: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Promise<HeldFile | null>;
}

export interface FileCache {
  // where a file is drawn from on this phone, fetched on a miss; null when it cannot be had now
  // (offline, or the cloud holds none)
  readonly fileUri: (sha: string) => Promise<string | null>;
  // a card's cover: the file itself when it is small, else a thumbnail made once; null too for a
  // picture this phone will not decode
  readonly thumbUri: (sha: string) => Promise<string | null>;
  // a file as this phone holds it, else fetched and kept, as the editor page draws a file a note
  // names, with the type it was kept as; null when it cannot be had now
  readonly heldFile: (sha: string) => Promise<HeldFile | null>;
  // a file this phone sent, kept as it went
  readonly keep: (sha: string, file: HeldFile) => Promise<void>;
  // every file of the account goes: a sign-out, a revocation, a new sign-in
  readonly clear: () => Promise<void>;
}

// a cover up to this size is drawn as it is; past it, from its thumbnail
/** @internal */
export const THUMB_OVER_BYTES = 512 * 1024;

const thumbName = (sha: string): string => `${sha}.thumb`;

// the type a file was kept as sits beside it; a media type is ASCII, a byte a character
const typeName = (name: string): string => `${name}.type`;
const typeBytes = (mime: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(mime, (character) => character.codePointAt(0) ?? 0);

// the run of `work` already on its way under `key`, else a new one, kept until it settles
const once = async <T>(
  running: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> => {
  const joined = running.get(key);
  if (joined !== undefined) {
    return await joined;
  }
  const started = work();
  running.set(key, started);
  try {
    return await started;
  } finally {
    running.delete(key);
  }
};

export const createFileCache = (ports: FileCachePorts): FileCache => {
  const { folder } = ports;
  const lock = serialLock();
  // moved by every clear: a landing that began under another generation lands nothing
  let generation = 0;
  // covers this phone will not draw, tried once a session
  const unshrinkable = new Set<string>();
  // the cap bounds one decode, and a page of rows asks for its covers all at once
  const decoding = serialLock();
  // one download and one landing per file however many screens ask for it at once; a clear lets
  // the old ones go, which land nothing
  let downloads = new Map<string, Promise<HeldFile | null>>();
  let landings = new Map<string, Promise<string | null>>();

  // the type first: the bytes are what makes the file found, so it is never found untyped
  const land = async (since: number, name: string, file: HeldFile): Promise<string | null> =>
    await lock(async () => {
      if (since !== generation) {
        return null;
      }
      await folder.write(typeName(name), typeBytes(file.mime));
      return await folder.write(name, file.bytes);
    });

  // plain bytes for a file whose type went with a purge
  const typeOf = async (name: string): Promise<string> => {
    const bytes = await folder.read(typeName(name));
    return bytes === null ? UNKNOWN_FILE_TYPE : String.fromCodePoint(...bytes);
  };

  // the file from the cloud; null offline, when the cloud did not answer or holds none
  const fetched = async (sha: string): Promise<HeldFile | null> =>
    await once(downloads, sha, async () => {
      try {
        return await ports.download(sha);
      } catch {
        return null;
      }
    });

  // the file kept on this phone, landing `file` unless a landing of it is already on its way
  const keptFile = async (
    since: number,
    sha: string,
    file: () => Promise<HeldFile | null>,
  ): Promise<string | null> =>
    await once(landings, sha, async () => {
      const held = await folder.uri(sha);
      if (held !== null) {
        return held;
      }
      const got = await file();
      return got === null ? null : await land(since, sha, got);
    });

  const fileUri = async (sha: string): Promise<string | null> =>
    await keptFile(generation, sha, async () => await fetched(sha));

  // the file as this phone holds it, else as the cloud answers it; `uri` keeps it and says where
  // it is drawn from, null when a clear came between
  const bytesOf = async (
    since: number,
    sha: string,
  ): Promise<{
    readonly file: HeldFile;
    readonly uri: () => Promise<string | null>;
  } | null> => {
    const bytes = await folder.read(sha);
    if (bytes !== null) {
      return { file: { bytes, mime: await typeOf(sha) }, uri: async () => await fileUri(sha) };
    }
    const file = await fetched(sha);
    return file === null
      ? null
      : {
          file,
          uri: async () => await keptFile(since, sha, async () => await Promise.resolve(file)),
        };
  };

  const thumbUri = async (sha: string): Promise<string | null> =>
    await once(landings, thumbName(sha), async () => {
      const since = generation;
      const name = thumbName(sha);
      const made = await folder.uri(name);
      if (made !== null) {
        return made;
      }
      if (unshrinkable.has(sha)) {
        return null;
      }
      const held = await bytesOf(since, sha);
      if (held === null) {
        return null;
      }
      const { bytes } = held.file;
      // decoded as what its first bytes say it is, which a cover's thumbnail is made from
      const mime = sniffMedia(bytes)?.mediaType ?? null;
      const size = mime === null ? null : pixelSize(bytes, mime);
      const refused = size !== null && !decodable(size);
      if (size !== null && !refused && bytes.byteLength <= THUMB_OVER_BYTES) {
        return await held.uri();
      }
      const shrunk =
        mime === null || refused
          ? null
          : await decoding(async () => await ports.shrink(bytes, mime)).catch(() => null);
      if (shrunk === null) {
        unshrinkable.add(sha);
        // kept all the same, so the next draw reads it here rather than downloading it again
        await held.uri();
        return null;
      }
      return await land(since, name, shrunk);
    });

  const heldFile = async (sha: string): Promise<HeldFile | null> => {
    const held = await bytesOf(generation, sha);
    if (held === null) {
      return null;
    }
    await held.uri();
    return held.file;
  };

  const keep = async (sha: string, file: HeldFile): Promise<void> => {
    await land(generation, sha, file);
  };

  const clear = async (): Promise<void> => {
    await lock(async () => {
      generation += 1;
      downloads = new Map();
      landings = new Map();
      unshrinkable.clear();
      await folder.clear();
    });
  };

  return { clear, fileUri, heldFile, keep, thumbUri };
};

// the format a cover's thumbnail is written in: one that keeps transparency for every source that
// can carry it, and JPEG only for a JPEG
export const thumbFormatOf = (mime: string): "png" | "jpeg" =>
  mime === "image/jpeg" ? "jpeg" : "png";
