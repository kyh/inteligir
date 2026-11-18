import { UNKNOWN_FILE_TYPE } from "@repo/contract/items/item-kind";
import { decodable } from "@repo/contract/items/link-fill";
import { pixelSize, sniffMedia } from "@repo/contract/items/sniff-media";
import type { PixelSize } from "@repo/contract/items/sniff-media";
import { serialLock } from "@repo/client/serial-lock";

export interface FileFolder {
  readonly write: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  readonly read: (name: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  readonly uri: (name: string) => Promise<string | null>;
  readonly clear: () => Promise<void>;
}

export interface HeldFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

export interface FileCachePorts {
  readonly folder: FileFolder;
  readonly download: (sha: string) => Promise<HeldFile | null>;
  readonly measure: (uri: string) => Promise<PixelSize | null>;
}

export interface FileCache {
  readonly fileUri: (sha: string) => Promise<string | null>;
  readonly coverUri: (sha: string) => Promise<string | null>;
  readonly heldFile: (sha: string) => Promise<HeldFile | null>;
  readonly keep: (sha: string, file: HeldFile) => Promise<void>;
  readonly clear: () => Promise<void>;
}

const typeName = (name: string) => `${name}.type`;

const typeBytes = (mime: string) =>
  Uint8Array.from(mime, (character) => character.codePointAt(0) ?? 0);

const coverName = (sha: string) => `${sha}.cover`;
const DRAWN = 1;
const NOT_DRAWN = 0;

const once = async <T>(running: Map<string, Promise<T>>, key: string, work: () => Promise<T>) => {
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

export const createFileCache = (ports: FileCachePorts) => {
  const { folder } = ports;
  const lock = serialLock();
  let generation = 0;
  let downloads = new Map<string, Promise<HeldFile | null>>();
  let landings = new Map<string, Promise<string | null>>();

  const landed = async <T>(since: number, write: () => Promise<T>) =>
    await lock(async () => (since === generation ? await write() : null));

  const land = async (since: number, name: string, file: HeldFile) =>
    await landed(since, async () => {
      await folder.write(typeName(name), typeBytes(file.mime));

      return await folder.write(name, file.bytes);
    });

  const typeOf = async (name: string) => {
    const bytes = await folder.read(typeName(name));

    return bytes === null ? UNKNOWN_FILE_TYPE : String.fromCodePoint(...bytes);
  };

  const fetched = async (sha: string) =>
    await once(downloads, sha, async () => {
      try {
        return await ports.download(sha);
      } catch {
        return null;
      }
    });

  const keptFile = async (since: number, sha: string, file: () => Promise<HeldFile | null>) =>
    await once(landings, sha, async () => {
      const held = await folder.uri(sha);

      if (held !== null) {
        return held;
      }

      const got = await file();

      return got === null ? null : await land(since, sha, got);
    });

  const fileUri = async (sha: string) =>
    await keptFile(generation, sha, async () => await fetched(sha));

  const bytesOf = async (since: number, sha: string) => {
    const bytes = await folder.read(sha);

    if (bytes !== null) {
      return {
        file: { bytes, mime: await typeOf(sha) },
        uri: async () => await fileUri(sha),
      } satisfies {
        readonly file: HeldFile;
        readonly uri: () => Promise<string | null>;
      } | null;
    }

    const file = await fetched(sha);

    return (
      file === null
        ? null
        : {
            file,
            uri: async () => await keptFile(since, sha, async () => await Promise.resolve(file)),
          }
    ) satisfies {
      readonly file: HeldFile;
      readonly uri: () => Promise<string | null>;
    } | null;
  };

  const drawn = async (bytes: Uint8Array, uri: string) => {
    const sniffed = sniffMedia(bytes);

    if (sniffed?.kind !== "image" || sniffed.mediaType === "image/gif") {
      return false;
    }

    const size = pixelSize(bytes, sniffed.mediaType) ?? (await ports.measure(uri));

    return size !== null && decodable(size);
  };

  const coverUri = async (sha: string) =>
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

  const heldFile = async (sha: string) => {
    const held = await bytesOf(generation, sha);

    if (held === null) {
      return null;
    }

    await held.uri();

    return held.file;
  };

  const keep = async (sha: string, file: HeldFile) => {
    await land(generation, sha, file);
  };

  const clear = async () => {
    await lock(async () => {
      generation += 1;
      downloads = new Map();
      landings = new Map();
      await folder.clear();
    });
  };

  return { clear, coverUri, fileUri, heldFile, keep } satisfies FileCache;
};
