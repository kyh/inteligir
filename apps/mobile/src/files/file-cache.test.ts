import type { ReplicaSql } from "@repo/library-replica/replica-ports";
import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import { describe, expect, it, vi } from "vitest";
import { openNodeReplicaSql } from "../lib/node-replica-sql";
import { openPhoneTables } from "../lib/phone-db";
import { deferred, nextTask } from "../test-support/async";
import { memoryFolders } from "../test-support/memory-folders";
import { createFileCache, thumbFormatOf, THUMB_OVER_BYTES } from "./file-cache";
import type { FileCachePorts, HeldFile } from "./file-cache";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

// a PNG's signature and header, enough for the sniffer to name it a picture
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// a PNG's signature and IHDR, which name its size whatever the rest of the file holds
const pngHead = (width: number, height: number): Uint8Array => {
  const head = new Uint8Array(24);
  head.set(PNG);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
};

// an AVIF's first box: a picture the sniffer names, and whose header says no size it can read
const AVIF = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);

const bytesOf = (size: number, head: Uint8Array = new Uint8Array()): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
};

// the phone's database as the composition opens it: the replica's schema, then the phone's own
const phoneSql = async (): Promise<ReplicaSql> => {
  const sql = openNodeReplicaSql(":memory:");
  await sql.exclusive(async (tx) => await runPlanAsync(tx, ensureLibrarySchema("replica")));
  await openPhoneTables(sql);
  return sql;
};

// a note whose body embeds `sha`, the person's own, so its picture is pinned
const embedIn = async (sql: ReplicaSql, sha: string): Promise<void> => {
  await sql.run(
    `INSERT INTO items (id, kind, title, saved_at, updated_at, seq, schema, fetch_state, aliases, properties, tags, card, purged)
     VALUES ('n1', 'note', 'Trip', 1, 1, 1, 1, 'none', '[]', '{}', '[]', '{"outline":[],"preview":"","title":"Trip","words":0}', 0)`,
    [],
  );
  await sql.run(
    "INSERT INTO blocks (item_id, block_id, ord, section, json, hash, text, annotation_ids, seq) VALUES ('n1', 'b1', 'a0', 'note', ?, 'h', '', '[]', 1)",
    [JSON.stringify({ sha, type: "img" })],
  );
};

// what the cloud serves, by sha: a file's bytes, served as a picture unless the case names a type
type Served = Map<string, Uint8Array<ArrayBuffer> | HeldFile>;

const servedFile = (file: Uint8Array<ArrayBuffer> | HeldFile): HeldFile =>
  file instanceof Uint8Array ? { bytes: file, mime: "image/png" } : file;

const cacheOver = (
  sql: ReplicaSql,
  more: Partial<FileCachePorts> & { readonly served?: Served } = {},
) => {
  const folders = memoryFolders();
  const asked: string[] = [];
  let now = 1000;
  const served: Served = more.served ?? new Map();
  const cache = createFileCache({
    capBytes: 100,
    download: async (sha) => {
      asked.push(sha);
      const file = served.get(sha);
      return await Promise.resolve(file === undefined ? null : servedFile(file));
    },
    folders,
    now: () => {
      now += 1;
      return now;
    },
    shrink: async () => await Promise.resolve(null),
    sql,
    ...more,
  });
  return { asked, cache, folders, served };
};

describe("the phone's copy of the library's files", () => {
  it("fetches a file the first time a screen draws it, and draws it from the phone after", async () => {
    const sql = await phoneSql();
    const { asked, cache, folders, served } = cacheOver(sql);
    served.set(SHA_A, bytesOf(10));

    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://cache/${SHA_A}`);
    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://cache/${SHA_A}`);
    expect(asked).toStrictEqual([SHA_A]);
    expect(folders.held("cache")).toStrictEqual([SHA_A]);
  });

  it("answers a file for the editor page: a staged one at once, a fetched one kept, pinned when a note embeds it", async () => {
    const sql = await phoneSql();
    const { asked, cache, folders, served } = cacheOver(sql);
    await embedIn(sql, SHA_B);
    await cache.staged.put(SHA_A, bytesOf(8, PNG), "image/png");
    served.set(SHA_B, bytesOf(12, PNG));

    await expect(cache.heldFile(SHA_A)).resolves.toStrictEqual({
      bytes: bytesOf(8, PNG),
      mime: "image/png",
    });
    await expect(cache.heldFile(SHA_B)).resolves.toStrictEqual({
      bytes: bytesOf(12, PNG),
      mime: "image/png",
    });
    await expect(cache.heldFile(SHA_B)).resolves.toStrictEqual({
      bytes: bytesOf(12, PNG),
      mime: "image/png",
    });
    await expect(cache.heldFile(SHA_C)).resolves.toBeNull();
    expect(asked).toStrictEqual([SHA_B, SHA_C]);
    expect(folders.held("pinned")).toStrictEqual([SHA_B]);
  });

  it("keeps each file's type wherever it moves: staged, kept once sent, fetched and drawn again", async () => {
    const sql = await phoneSql();
    const { cache, served } = cacheOver(sql);
    // a recording's bytes, whose type no sniff of its first bytes would name
    const clip = bytesOf(6);
    await cache.staged.put(SHA_A, clip, "video/quicktime");
    await expect(cache.heldFile(SHA_A)).resolves.toMatchObject({ mime: "video/quicktime" });
    await cache.staged.remove(SHA_A);
    await expect(cache.heldFile(SHA_A)).resolves.toStrictEqual({
      bytes: clip,
      mime: "video/quicktime",
    });

    served.set(SHA_B, { bytes: bytesOf(6), mime: "video/mp4" });
    await expect(cache.heldFile(SHA_B)).resolves.toMatchObject({ mime: "video/mp4" });
    await expect(cache.heldFile(SHA_B), "drawn again from the phone's copy").resolves.toMatchObject(
      { mime: "video/mp4" },
    );
    await expect(sql.all("SELECT sha FROM phone_staged", [])).resolves.toStrictEqual([]);
  });

  it("answers nothing for a file the cloud holds none of, or cannot be reached for", async () => {
    const sql = await phoneSql();
    const { cache } = cacheOver(sql, {
      download: async (sha) => {
        if (sha === SHA_B) {
          throw new TypeError("the network is down");
        }
        return await Promise.resolve(null);
      },
    });
    await expect(cache.fileUri(SHA_A)).resolves.toBeNull();
    await expect(cache.fileUri(SHA_B)).resolves.toBeNull();
  });

  it("lets the least recently drawn copies go past the cap", async () => {
    const sql = await phoneSql();
    const { cache, folders, served } = cacheOver(sql);
    served.set(SHA_A, bytesOf(40));
    served.set(SHA_B, bytesOf(40));
    served.set(SHA_C, bytesOf(40));

    await cache.fileUri(SHA_A);
    await cache.fileUri(SHA_B);
    // drawn again, so B is the oldest now
    await cache.fileUri(SHA_A);
    await cache.fileUri(SHA_C);

    expect(folders.held("cache").toSorted()).toStrictEqual([SHA_A, SHA_C]);
  });

  it("pins what the person's own notes embed, out of the cache's reach, until no note does", async () => {
    const sql = await phoneSql();
    await embedIn(sql, SHA_A);
    const { cache, folders, served } = cacheOver(sql, { capBytes: 200 });
    served.set(SHA_A, bytesOf(90));
    served.set(SHA_B, bytesOf(90));

    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://pinned/${SHA_A}`);
    await cache.fileUri(SHA_B);
    expect(folders.held("pinned")).toStrictEqual([SHA_A]);

    await sql.run("UPDATE items SET deleted_at = 5 WHERE id = 'n1'", []);
    await cache.sweep();
    expect(folders.held("pinned")).toStrictEqual([]);
    expect(folders.held("cache")).toContain(SHA_A);
  });

  it("draws a file this phone added from where it waits to be sent", async () => {
    const sql = await phoneSql();
    const { asked, cache } = cacheOver(sql);
    await cache.staged.put(SHA_A, bytesOf(4), "image/jpeg");
    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://staged/${SHA_A}`);
    expect(asked).toStrictEqual([]);
  });

  it("sweeps a file no row names, and a row whose file the OS purged", async () => {
    const sql = await phoneSql();
    const { cache, folders, served } = cacheOver(sql);
    served.set(SHA_A, bytesOf(4));
    await cache.fileUri(SHA_A);
    await folders.write("cache", SHA_B, bytesOf(4));
    await folders.remove("cache", SHA_A);

    await cache.sweep();
    expect(folders.held("cache")).toStrictEqual([]);
    await expect(sql.all("SELECT name FROM phone_files", [])).resolves.toStrictEqual([]);
  });

  it("lands nothing fetched for an account the phone left while it came", async () => {
    const sql = await phoneSql();
    const answer = deferred<HeldFile | null>();
    const { cache, folders } = cacheOver(sql, { download: async () => await answer.promise });

    const drawing = cache.fileUri(SHA_A);
    await cache.clear();
    answer.resolve({ bytes: bytesOf(4), mime: "image/png" });

    await expect(drawing).resolves.toBeNull();
    expect(folders.held("cache")).toStrictEqual([]);
  });

  it("draws no cover whose header names more pixels than a phone may decode, whatever its file's size", async () => {
    const sql = await phoneSql();
    const shrunk: string[] = [];
    const { asked, cache, folders, served } = cacheOver(sql, {
      capBytes: 10 * THUMB_OVER_BYTES,
      shrink: async (_bytes, mime) => {
        shrunk.push(mime);
        return await Promise.resolve({ bytes: bytesOf(8), mime: "image/png" });
      },
    });
    served.set(SHA_A, bytesOf(THUMB_OVER_BYTES + 1, pngHead(30_000, 30_000)));
    served.set(SHA_B, bytesOf(100, pngHead(30_000, 30_000)));

    await expect(cache.thumbUri(SHA_A)).resolves.toBeNull();
    await expect(cache.thumbUri(SHA_B)).resolves.toBeNull();
    await expect(cache.thumbUri(SHA_A), "asked again, for the same answer").resolves.toBeNull();
    expect(shrunk).toStrictEqual([]);
    expect(asked, "kept, so asking again downloads nothing").toStrictEqual([SHA_A, SHA_B]);
    expect(folders.held("cache").toSorted()).toStrictEqual([SHA_A, SHA_B]);
  });

  it("draws a picture whose header says no size only from a thumbnail, whatever its file's size", async () => {
    const sql = await phoneSql();
    const shrunk: string[] = [];
    const { cache, served } = cacheOver(sql, {
      shrink: async (_bytes, mime) => {
        shrunk.push(mime);
        return await Promise.resolve(
          shrunk.length === 1 ? { bytes: bytesOf(8), mime: "image/png" } : null,
        );
      },
    });
    served.set(SHA_A, bytesOf(100, AVIF));
    served.set(SHA_B, bytesOf(100, AVIF));

    await expect(cache.thumbUri(SHA_A)).resolves.toBe(`memory://cache/${SHA_A}.thumb`);
    await expect(cache.thumbUri(SHA_B), "no thumbnail, so no drawing").resolves.toBeNull();
    expect(shrunk).toStrictEqual(["image/avif", "image/avif"]);
  });

  it("decodes one cover at a time, however many rows ask at once", async () => {
    const sql = await phoneSql();
    const first = deferred<HeldFile | null>();
    const started: number[] = [];
    const { cache, served } = cacheOver(sql, {
      capBytes: 10 * THUMB_OVER_BYTES,
      shrink: async () => {
        started.push(started.length);
        return started.length === 1
          ? await first.promise
          : await Promise.resolve({ bytes: bytesOf(8), mime: "image/png" });
      },
    });
    served.set(SHA_A, bytesOf(THUMB_OVER_BYTES + 1, PNG));
    served.set(SHA_B, bytesOf(THUMB_OVER_BYTES + 1, PNG));

    const drawing = [cache.thumbUri(SHA_A), cache.thumbUri(SHA_B)];
    await vi.waitFor(() => {
      expect(started).toHaveLength(1);
    });
    await nextTask();
    expect(started, "the second waits for the first").toHaveLength(1);
    first.resolve({ bytes: bytesOf(8), mime: "image/png" });
    await expect(Promise.all(drawing)).resolves.toStrictEqual([
      `memory://cache/${SHA_A}.thumb`,
      `memory://cache/${SHA_B}.thumb`,
    ]);
  });

  it("draws a large cover from a thumbnail made once, and tries an undecodable one once a session", async () => {
    const sql = await phoneSql();
    const shrunk: string[] = [];
    const { asked, cache, folders, served } = cacheOver(sql, {
      capBytes: 10 * THUMB_OVER_BYTES,
      shrink: async (_bytes, mime) => {
        shrunk.push(mime);
        return await Promise.resolve(
          shrunk.length === 1 ? { bytes: bytesOf(8), mime: "image/png" } : null,
        );
      },
    });
    served.set(SHA_A, bytesOf(THUMB_OVER_BYTES + 1, PNG));
    served.set(SHA_B, bytesOf(THUMB_OVER_BYTES + 1, PNG));
    served.set(SHA_C, bytesOf(100, PNG));

    await expect(cache.thumbUri(SHA_A)).resolves.toBe(`memory://cache/${SHA_A}.thumb`);
    await expect(cache.thumbUri(SHA_A)).resolves.toBe(`memory://cache/${SHA_A}.thumb`);
    await expect(cache.thumbUri(SHA_B)).resolves.toBeNull();
    await expect(cache.thumbUri(SHA_B)).resolves.toBeNull();
    await expect(cache.thumbUri(SHA_C)).resolves.toBe(`memory://cache/${SHA_C}`);
    expect(shrunk).toStrictEqual(["image/png", "image/png"]);
    expect(folders.held("cache")).toContain(`${SHA_A}.thumb`);
    // each cover crossed once: the bytes a thumbnail was tried from are the ones kept
    expect(asked).toStrictEqual([SHA_A, SHA_B, SHA_C]);
  });

  it("fetches a file once however many screens ask for it at once", async () => {
    const sql = await phoneSql();
    const answer = deferred<HeldFile | null>();
    const { asked, cache } = cacheOver(sql, {
      download: async (sha) => {
        asked.push(sha);
        return await answer.promise;
      },
    });

    const drawing = [cache.fileUri(SHA_A), cache.fileUri(SHA_A), cache.thumbUri(SHA_A)];
    answer.resolve({ bytes: bytesOf(24, PNG), mime: "image/png" });

    await expect(Promise.all(drawing)).resolves.toStrictEqual([
      `memory://cache/${SHA_A}`,
      `memory://cache/${SHA_A}`,
      `memory://cache/${SHA_A}`,
    ]);
    expect(asked).toStrictEqual([SHA_A]);
  });

  it("keeps a file this phone sent once its write lands, pinned when a note embeds it", async () => {
    const sql = await phoneSql();
    await embedIn(sql, SHA_B);
    const { asked, cache, folders } = cacheOver(sql);
    await cache.staged.put(SHA_A, bytesOf(4), "image/jpeg");
    await cache.staged.put(SHA_B, bytesOf(4), "image/png");

    await cache.staged.remove(SHA_A);
    await cache.staged.remove(SHA_B);

    expect(folders.held("staged")).toStrictEqual([]);
    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://cache/${SHA_A}`);
    await expect(cache.fileUri(SHA_B)).resolves.toBe(`memory://pinned/${SHA_B}`);
    expect(asked).toStrictEqual([]);
  });

  it("keeps a thumbnail's transparency for every source that can carry it", () => {
    expect(thumbFormatOf("image/png")).toBe("png");
    expect(thumbFormatOf("image/webp")).toBe("png");
    expect(thumbFormatOf("image/gif")).toBe("png");
    expect(thumbFormatOf("image/jpeg")).toBe("jpeg");
  });
});
