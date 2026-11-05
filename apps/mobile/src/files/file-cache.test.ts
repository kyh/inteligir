import type { ReplicaSql } from "@repo/library-replica/replica-ports";
import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import { describe, expect, it } from "vitest";
import { openNodeReplicaSql } from "../lib/node-replica-sql";
import { openPhoneTables } from "../lib/phone-db";
import { deferred } from "../test-support/async";
import { memoryFolders } from "../test-support/memory-folders";
import { createFileCache, thumbFormatOf, THUMB_OVER_BYTES } from "./file-cache";
import type { FileCachePorts } from "./file-cache";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

// a PNG's signature and header, enough for the sniffer to name it a picture
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

const cacheOver = (
  sql: ReplicaSql,
  more: Partial<FileCachePorts> & { readonly served?: Map<string, Uint8Array<ArrayBuffer>> } = {},
) => {
  const folders = memoryFolders();
  const asked: string[] = [];
  let now = 1000;
  const served = more.served ?? new Map<string, Uint8Array<ArrayBuffer>>();
  const cache = createFileCache({
    capBytes: 100,
    download: async (sha) => {
      asked.push(sha);
      return await Promise.resolve(served.get(sha) ?? null);
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

    expect(await cache.fileUri(SHA_A)).toBe(`memory://cache/${SHA_A}`);
    expect(await cache.fileUri(SHA_A)).toBe(`memory://cache/${SHA_A}`);
    expect(asked).toEqual([SHA_A]);
    expect(folders.held("cache")).toEqual([SHA_A]);
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
    expect(await cache.fileUri(SHA_A)).toBeNull();
    expect(await cache.fileUri(SHA_B)).toBeNull();
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

    expect(folders.held("cache").toSorted()).toEqual([SHA_A, SHA_C]);
  });

  it("pins what the person's own notes embed, out of the cache's reach, until no note does", async () => {
    const sql = await phoneSql();
    await embedIn(sql, SHA_A);
    const { cache, folders, served } = cacheOver(sql, { capBytes: 200 });
    served.set(SHA_A, bytesOf(90));
    served.set(SHA_B, bytesOf(90));

    expect(await cache.fileUri(SHA_A)).toBe(`memory://pinned/${SHA_A}`);
    await cache.fileUri(SHA_B);
    expect(folders.held("pinned")).toEqual([SHA_A]);

    await sql.run("UPDATE items SET deleted_at = 5 WHERE id = 'n1'", []);
    await cache.sweep();
    expect(folders.held("pinned")).toEqual([]);
    expect(folders.held("cache")).toContain(SHA_A);
  });

  it("draws a file this phone added from where it waits to be sent", async () => {
    const sql = await phoneSql();
    const { asked, cache } = cacheOver(sql);
    await cache.staged.put(SHA_A, bytesOf(4), "image/jpeg");
    expect(await cache.fileUri(SHA_A)).toBe(`memory://staged/${SHA_A}`);
    expect(asked).toEqual([]);
  });

  it("sweeps a file no row names, and a row whose file the OS purged", async () => {
    const sql = await phoneSql();
    const { cache, folders, served } = cacheOver(sql);
    served.set(SHA_A, bytesOf(4));
    await cache.fileUri(SHA_A);
    await folders.write("cache", SHA_B, bytesOf(4));
    await folders.remove("cache", SHA_A);

    await cache.sweep();
    expect(folders.held("cache")).toEqual([]);
    expect(await sql.all("SELECT name FROM phone_files", [])).toEqual([]);
  });

  it("lands nothing fetched for an account the phone left while it came", async () => {
    const sql = await phoneSql();
    const answer = deferred<Uint8Array<ArrayBuffer> | null>();
    const { cache, folders } = cacheOver(sql, { download: async () => await answer.promise });

    const drawing = cache.fileUri(SHA_A);
    await cache.clear();
    answer.resolve(bytesOf(4));

    expect(await drawing).toBeNull();
    expect(folders.held("cache")).toEqual([]);
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

    expect(await cache.thumbUri(SHA_A)).toBe(`memory://cache/${SHA_A}.thumb`);
    expect(await cache.thumbUri(SHA_A)).toBe(`memory://cache/${SHA_A}.thumb`);
    expect(await cache.thumbUri(SHA_B)).toBe(`memory://cache/${SHA_B}`);
    expect(await cache.thumbUri(SHA_B)).toBe(`memory://cache/${SHA_B}`);
    expect(await cache.thumbUri(SHA_C)).toBe(`memory://cache/${SHA_C}`);
    expect(shrunk).toEqual(["image/png", "image/png"]);
    expect(folders.held("cache")).toContain(`${SHA_A}.thumb`);
    // each cover crossed once: the bytes a thumbnail was tried from are the ones kept
    expect(asked).toEqual([SHA_A, SHA_B, SHA_C]);
  });

  it("fetches a file once however many screens ask for it at once", async () => {
    const sql = await phoneSql();
    const answer = deferred<Uint8Array<ArrayBuffer> | null>();
    const { asked, cache } = cacheOver(sql, {
      download: async (sha) => {
        asked.push(sha);
        return await answer.promise;
      },
    });

    const drawing = [cache.fileUri(SHA_A), cache.fileUri(SHA_A), cache.thumbUri(SHA_A)];
    answer.resolve(bytesOf(10, PNG));

    expect(await Promise.all(drawing)).toEqual([
      `memory://cache/${SHA_A}`,
      `memory://cache/${SHA_A}`,
      `memory://cache/${SHA_A}`,
    ]);
    expect(asked).toEqual([SHA_A]);
  });

  it("keeps a file this phone sent once its write lands, pinned when a note embeds it", async () => {
    const sql = await phoneSql();
    await embedIn(sql, SHA_B);
    const { asked, cache, folders } = cacheOver(sql);
    await cache.staged.put(SHA_A, bytesOf(4), "image/jpeg");
    await cache.staged.put(SHA_B, bytesOf(4), "image/png");

    await cache.staged.remove(SHA_A);
    await cache.staged.remove(SHA_B);

    expect(folders.held("staged")).toEqual([]);
    expect(await cache.fileUri(SHA_A)).toBe(`memory://cache/${SHA_A}`);
    expect(await cache.fileUri(SHA_B)).toBe(`memory://pinned/${SHA_B}`);
    expect(asked).toEqual([]);
  });

  it("keeps a thumbnail's transparency for every source that can carry it", () => {
    expect(thumbFormatOf("image/png")).toBe("png");
    expect(thumbFormatOf("image/webp")).toBe("png");
    expect(thumbFormatOf("image/gif")).toBe("png");
    expect(thumbFormatOf("image/jpeg")).toBe("jpeg");
  });
});
