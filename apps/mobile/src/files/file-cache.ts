// The phone's copy of the library's files: each by its SHA-256 with the type it was sent or served
// as, fetched from the cloud once, the first time a screen draws it, however many screens ask at
// once, into the OS's cache, which iOS may purge, so a purged file is fetched again. A file this
// phone sent is kept as it went, so the phone never downloads what it sent. A card's cover is the
// kept file itself, which React Native's Image decodes at the row's size: whether a row draws it
// is judged once from its bytes and kept beside it, and a cover judged no shows the card's
// placeholder.
//
// Every landing runs under one lock with the sign-in's clear, and checks that no clear came
// between its download and its landing, so a file of an account this phone left never lands
// after the wipe.

import { UNKNOWN_FILE_TYPE } from "@repo/contract/items/item-kind";
import { decodable } from "@repo/contract/items/link-fill";
import { pixelSize, sniffMedia } from "@repo/contract/items/sniff-media";
import type { PixelSize } from "@repo/contract/items/sniff-media";
import { serialLock } from "@repo/client/serial-lock";

// the one folder the files are kept in, each by its name
export interface FileFolder {
  // the file's address once written
  readonly write: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  // null when the folder holds none by that name
  readonly read: (name: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  readonly uri: (name: string) => Promise<string | null>;
  readonly clear: () => Promise<void>;
}

// a file's bytes and the type it was sent as, or the cloud served it as
export interface HeldFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

export interface FileCachePorts {
  readonly folder: FileFolder;
  // the file from the cloud, whole and hash-checked, with the type it serves; null when the cloud
  // holds none
  readonly download: (sha: string) => Promise<HeldFile | null>;
  // the system's measure of the picture kept at an address, decoding nothing, for a header no
  // reader here parses; null when it finds no picture there
  readonly measure: (uri: string) => Promise<PixelSize | null>;
}

export interface FileCache {
  // where a file is drawn from on this phone, fetched on a miss; null when it cannot be had now
  // (offline, or the cloud holds none)
  readonly fileUri: (sha: string) => Promise<string | null>;
  // a card's cover, drawn from the kept file; null too for a picture a row will not draw
  readonly coverUri: (sha: string) => Promise<string | null>;
  // a file as this phone holds it, else fetched and kept, as the editor page draws a file a note
  // names, with the type it was kept as; null when it cannot be had now
  readonly heldFile: (sha: string) => Promise<HeldFile | null>;
  // a file this phone sent, kept as it went
  readonly keep: (sha: string, file: HeldFile) => Promise<void>;
  // every file of the account goes: a sign-out, a revocation, a new sign-in
  readonly clear: () => Promise<void>;
}

// the type a file was kept as sits beside it; a media type is ASCII, a byte a character
const typeName = (name: string): string => `${name}.type`;
const typeBytes = (mime: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(mime, (character) => character.codePointAt(0) ?? 0);

// whether a row draws a file as a cover sits beside it too, one byte: a hash names the bytes that
// were judged, so the verdict holds for as long as it is kept
const coverName = (sha: string): string => `${sha}.cover`;
const DRAWN = 1;
const NOT_DRAWN = 0;

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
  // one download and one landing per file however many screens ask for it at once; a clear lets
  // the old ones go, which land nothing
  let downloads = new Map<string, Promise<HeldFile | null>>();
  let landings = new Map<string, Promise<string | null>>();

  const landed = async <T>(since: number, write: () => Promise<T>): Promise<T | null> =>
    await lock(async () => (since === generation ? await write() : null));

  // the type first: the bytes are what makes the file found, so it is never found untyped
  const land = async (since: number, name: string, file: HeldFile): Promise<string | null> =>
    await landed(since, async () => {
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

  // whether a row draws the picture these bytes are, kept at `uri`: one within what a phone may
  // decode, by its header's size, else the system's. React Native decodes a GIF's every frame whole
  // and plays it, where it decodes any other picture at the row's size, so a GIF is never drawn
  const drawn = async (bytes: Uint8Array, uri: string): Promise<boolean> => {
    const sniffed = sniffMedia(bytes);
    if (sniffed?.kind !== "image" || sniffed.mediaType === "image/gif") {
      return false;
    }
    const size = pixelSize(bytes, sniffed.mediaType) ?? (await ports.measure(uri));
    return size !== null && decodable(size);
  };

  const coverUri = async (sha: string): Promise<string | null> =>
    await once(landings, coverName(sha), async () => {
      const since = generation;
      const judged = await folder.read(coverName(sha));
      if (judged !== null) {
        return judged[0] === DRAWN ? await fileUri(sha) : null;
      }
      const held = await bytesOf(since, sha);
      const uri = held === null ? null : await held.uri();
      if (held === null || uri === null) {
        return null;
      }
      const draws = await drawn(held.file.bytes, uri);
      const kept = await landed(
        since,
        async () => await folder.write(coverName(sha), Uint8Array.of(draws ? DRAWN : NOT_DRAWN)),
      );
      return draws && kept !== null ? uri : null;
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
      await folder.clear();
    });
  };

  return { clear, coverUri, fileUri, heldFile, keep };
};
