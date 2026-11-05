// The phone's copy of the library's files (spec §6, "What each device holds"): each by its
// SHA-256, fetched from the cloud once, the first time a screen draws it, however many screens ask
// at once. A file a live note of the person's embeds is pinned, kept in Documents out of the device
// backup and out of the cap's reach; everything else is a discardable copy in the OS's cache, which
// iOS may purge, the least recently drawn let go first past the cap. A file this phone added waits,
// staged, until the write that names it lands (the engine's StagedBlobs), draws from there
// meanwhile, and is kept once it lands, so the phone never downloads what it sent. A card's cover
// over 512 KB draws from a thumbnail made once, in a format that keeps a transparent cover's
// transparency, and a cover whose thumbnail could not be made is not tried again this session.
//
// Every landing in a folder or the index runs under one lock with the sign-in's clear, and checks
// that no clear came between its download and its landing, so a file of an account this phone
// left never lands after the wipe.

import type { ReplicaSql, StagedBlobs } from "@repo/library-replica/replica-ports";
import { serialLock } from "@repo/library-replica/serial-lock";
import { sniffMedia } from "@repo/notes/items/sniff-media";
import { z } from "zod";

// where a file is kept: pinned and staged in Documents, out of the backup; cache in Paths.cache
export type FilePlace = "pinned" | "cache" | "staged";

export interface FileFolders {
  // the file's address once written
  readonly write: (
    place: FilePlace,
    name: string,
    bytes: Uint8Array<ArrayBuffer>,
  ) => Promise<string>;
  // null when the folder holds none by that name
  readonly read: (place: FilePlace, name: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  readonly uri: (place: FilePlace, name: string) => Promise<string | null>;
  readonly remove: (place: FilePlace, name: string) => Promise<void>;
  readonly names: (place: FilePlace) => Promise<readonly string[]>;
  readonly clear: (place: FilePlace) => Promise<void>;
}

export interface ShrunkCover {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

export interface FileCachePorts {
  readonly sql: ReplicaSql;
  readonly folders: FileFolders;
  // the file's bytes from the cloud, whole and hash-checked; null when the cloud holds none
  readonly download: (sha: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  // a cover drawn at a card's width, or null when it cannot be decoded
  readonly shrink: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Promise<ShrunkCover | null>;
  readonly now: () => number;
  // the discardable copies' total, past which the least recently drawn go
  readonly capBytes: number;
}

export interface FileCache {
  // the engine's staged files; one whose write landed moves into the cache, or is pinned
  readonly staged: StagedBlobs;
  // where a file is drawn from on this phone, fetched on a miss; null when it cannot be had now
  // (offline, or the cloud holds none)
  readonly fileUri: (sha: string) => Promise<string | null>;
  // a card's cover: the file itself when it is small, else a thumbnail made once
  readonly thumbUri: (sha: string) => Promise<string | null>;
  // stray files and rows go, and a pinned file no note embeds any more goes to the cache
  readonly sweep: () => Promise<void>;
  // every file of the account goes: a sign-out, a revocation, a new sign-in
  readonly clear: () => Promise<void>;
}

// a cover up to this size is drawn as it is; past it, from its thumbnail
export const THUMB_OVER_BYTES = 512 * 1024;

const rowsSchema = z.array(
  z.object({
    bytes: z.number().int(),
    name: z.string(),
    place: z.enum(["pinned", "cache"]),
  }),
);
const countSchema = z.array(z.object({ total: z.number().nullable() }));

const thumbName = (sha: string): string => `${sha}.thumb`;

// what the person's own notes embed: a picture or a file named in a live item's note section
const isPinned = async (sql: ReplicaSql, sha: string): Promise<boolean> => {
  const rows = await sql.all(
    `SELECT 1 AS found FROM blocks
       JOIN items ON items.id = blocks.item_id
      WHERE blocks.section = 'note' AND items.deleted_at IS NULL AND instr(blocks.json, ?) > 0
      LIMIT 1`,
    [`"sha":"${sha}"`],
  );
  return rows.length > 0;
};

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
  const { folders, sql } = ports;
  const lock = serialLock();
  // moved by every clear: a landing that began under another generation lands nothing
  let generation = 0;
  // covers whose thumbnail could not be made, tried once a session
  const unshrinkable = new Set<string>();

  const index = async (name: string): Promise<z.infer<typeof rowsSchema>[number] | null> => {
    const [row] = rowsSchema.parse(
      await sql.all("SELECT name, place, bytes FROM phone_files WHERE name = ?", [name]),
    );
    return row ?? null;
  };

  const touch = async (name: string): Promise<void> => {
    await sql.run("UPDATE phone_files SET used_at = ? WHERE name = ?", [ports.now(), name]);
  };

  // the discardable copies past the cap go, the least recently drawn first
  const trim = async (): Promise<void> => {
    const [sum] = countSchema.parse(
      await sql.all("SELECT sum(bytes) AS total FROM phone_files WHERE place = 'cache'", []),
    );
    let total = sum?.total ?? 0;
    if (total <= ports.capBytes) {
      return;
    }
    const oldest = rowsSchema.parse(
      await sql.all(
        "SELECT name, place, bytes FROM phone_files WHERE place = 'cache' ORDER BY used_at",
        [],
      ),
    );
    for (const row of oldest) {
      if (total <= ports.capBytes) {
        return;
      }
      await folders.remove("cache", row.name);
      await sql.run("DELETE FROM phone_files WHERE name = ?", [row.name]);
      total -= row.bytes;
    }
  };

  // one download and one landing per file however many screens ask for it at once; a clear lets
  // the old ones go, which land nothing
  let downloads = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();
  let landings = new Map<string, Promise<string | null>>();
  // under the lock: the bytes written by `name` and indexed
  const keep = async (
    name: string,
    place: "pinned" | "cache",
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<string> => {
    const uri = await folders.write(place, name, bytes);
    await sql.run(
      `INSERT INTO phone_files (name, place, bytes, used_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET place = excluded.place, bytes = excluded.bytes,
         used_at = excluded.used_at`,
      [name, place, bytes.byteLength, ports.now()],
    );
    if (place === "cache") {
      await trim();
    }
    return uri;
  };

  // bytes fetched under `since` kept by `name`, unless a clear came between
  const land = async (
    since: number,
    name: string,
    place: "pinned" | "cache",
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<string | null> =>
    await lock(async () => (since === generation ? await keep(name, place, bytes) : null));

  // a file's own bytes fetched under `since`, pinned when a note embeds it
  const landFile = async (
    since: number,
    sha: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<string | null> =>
    await land(since, sha, (await isPinned(sql, sha)) ? "pinned" : "cache", bytes);

  // where this phone holds the file already, or null
  const heldUri = async (sha: string): Promise<string | null> => {
    const staged = await folders.uri("staged", sha);
    if (staged !== null) {
      return staged;
    }
    const row = await index(sha);
    if (row === null) {
      return null;
    }
    const uri = await folders.uri(row.place, sha);
    if (uri !== null) {
      await touch(sha);
    }
    return uri;
  };

  // the file's bytes from the cloud; null offline, when the cloud did not answer or holds none
  const fetched = async (sha: string): Promise<Uint8Array<ArrayBuffer> | null> =>
    await once(downloads, sha, async () => {
      try {
        return await ports.download(sha);
      } catch {
        return null;
      }
    });

  // the file kept on this phone, landing `bytes` unless a landing of it is already on its way
  const keptFile = async (
    since: number,
    sha: string,
    bytes: () => Promise<Uint8Array<ArrayBuffer> | null>,
  ): Promise<string | null> =>
    await once(landings, sha, async () => {
      const held = await heldUri(sha);
      if (held !== null) {
        return held;
      }
      const got = await bytes();
      return got === null ? null : await landFile(since, sha, got);
    });

  const fileUri = async (sha: string): Promise<string | null> =>
    await keptFile(generation, sha, async () => await fetched(sha));

  // the file's bytes as this phone holds them, else as the cloud answers them; `uri` keeps them
  // and says where they are drawn from, null when a clear came between
  const bytesOf = async (
    since: number,
    sha: string,
  ): Promise<{
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly uri: () => Promise<string | null>;
  } | null> => {
    for (const place of ["staged", "pinned", "cache"] as const) {
      const bytes = await folders.read(place, sha);
      if (bytes !== null) {
        return { bytes, uri: async () => await fileUri(sha) };
      }
    }
    const bytes = await fetched(sha);
    return bytes === null
      ? null
      : {
          bytes,
          uri: async () => await keptFile(since, sha, async () => await Promise.resolve(bytes)),
        };
  };

  const thumbUri = async (sha: string): Promise<string | null> =>
    await once(landings, thumbName(sha), async () => {
      const since = generation;
      const name = thumbName(sha);
      const row = await index(name);
      if (row !== null) {
        const uri = await folders.uri("cache", name);
        if (uri !== null) {
          await touch(name);
          return uri;
        }
      }
      if (unshrinkable.has(sha)) {
        return await fileUri(sha);
      }
      const held = await bytesOf(since, sha);
      if (held === null) {
        return null;
      }
      if (held.bytes.byteLength <= THUMB_OVER_BYTES) {
        return await held.uri();
      }
      const mime = sniffMedia(held.bytes)?.mediaType ?? null;
      const shrunk = mime === null ? null : await ports.shrink(held.bytes, mime).catch(() => null);
      if (shrunk === null) {
        unshrinkable.add(sha);
        return await held.uri();
      }
      return await land(since, name, "cache", shrunk.bytes);
    });

  const staged: StagedBlobs = {
    clear: async () => {
      await folders.clear("staged");
    },
    put: async (sha, bytes) => {
      await folders.write("staged", sha, bytes);
    },
    read: async (sha) => await folders.read("staged", sha),
    // the write naming it landed, so the cloud holds it: kept as a fetched copy would be
    remove: async (sha) => {
      await lock(async () => {
        const bytes = await folders.read("staged", sha);
        if (bytes !== null) {
          await keep(sha, (await isPinned(sql, sha)) ? "pinned" : "cache", bytes);
        }
        await folders.remove("staged", sha);
      });
    },
  };

  const sweep = async (): Promise<void> => {
    await lock(async () => {
      const rows = rowsSchema.parse(
        await sql.all("SELECT name, place, bytes FROM phone_files", []),
      );
      const known = new Set(rows.map((row) => `${row.place}/${row.name}`));
      for (const place of ["pinned", "cache"] as const) {
        for (const name of await folders.names(place)) {
          if (!known.has(`${place}/${name}`)) {
            await folders.remove(place, name);
          }
        }
      }
      const pinnedNames = await folders.names("pinned");
      const cacheNames = await folders.names("cache");
      const held = new Set([
        ...pinnedNames.map((name) => `pinned/${name}`),
        ...cacheNames.map((name) => `cache/${name}`),
      ]);
      for (const row of rows) {
        if (!held.has(`${row.place}/${row.name}`)) {
          await sql.run("DELETE FROM phone_files WHERE name = ?", [row.name]);
          continue;
        }
        if (row.place === "pinned" && !(await isPinned(sql, row.name))) {
          const bytes = await folders.read("pinned", row.name);
          await folders.remove("pinned", row.name);
          if (bytes === null) {
            await sql.run("DELETE FROM phone_files WHERE name = ?", [row.name]);
          } else {
            await folders.write("cache", row.name, bytes);
            await sql.run("UPDATE phone_files SET place = 'cache' WHERE name = ?", [row.name]);
          }
        }
      }
      await trim();
    });
  };

  const clear = async (): Promise<void> => {
    await lock(async () => {
      generation += 1;
      downloads = new Map();
      landings = new Map();
      unshrinkable.clear();
      await sql.run("DELETE FROM phone_files", []);
      for (const place of ["pinned", "cache", "staged"] as const) {
        await folders.clear(place);
      }
    });
  };

  return { clear, fileUri, staged, sweep, thumbUri };
};

// the format a cover's thumbnail is written in: one that keeps transparency for every source that
// can carry it, and JPEG only for a JPEG
export const thumbFormatOf = (mime: string): "png" | "jpeg" =>
  mime === "image/jpeg" ? "jpeg" : "png";
