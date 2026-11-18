// What every file store keeps to (`./file-store`), run against the folder on disk: an object
// written once and never over, read whole or by range, expiring a day after it was written until
// it is kept, and let go one at a time or by a prefix.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { diskFileStore } from "./disk-file-store";
import type { FileStore } from "./file-store";

const DAY_MS = 86_400_000;
const TEN = new TextEncoder().encode("0123456789");

const text = async (body: ReadableStream<Uint8Array>): Promise<string> =>
  await new Response(body).text();

const pathnameIn = (prefix: string) => `${prefix}${"a".repeat(64)}/${randomUUID()}`;

// the ten bytes sent as an upload streams them, in two chunks
const twoChunks = async function* twoChunks() {
  yield await Promise.resolve(TEN.subarray(0, 4));
  yield TEN.subarray(4);
};

const storeContract = (name: string, storeOf: () => Promise<FileStore>) => {
  describe(name, () => {
    it("writes an object once, reads it whole or by range, and never writes over it", async () => {
      const store = await storeOf();
      const pathname = pathnameIn(`files/${randomUUID()}/`);
      await store.put(pathname, TEN, "image/png");
      await expect(store.head(pathname)).resolves.toMatchObject({ bytes: 10, mime: "image/png" });

      const whole = await store.read(pathname, null);
      expect(whole?.range).toBeNull();
      await expect(text(whole?.body ?? new ReadableStream())).resolves.toBe("0123456789");
      const ranged = await store.read(pathname, { end: 5, start: 2 });
      expect(ranged?.range).toStrictEqual({ end: 5, start: 2 });
      await expect(text(ranged?.body ?? new ReadableStream())).resolves.toBe("2345");

      await expect(store.put(pathname, new Uint8Array([1]), "image/png")).rejects.toThrow();
      await expect(store.head(pathname)).resolves.toMatchObject({ bytes: 10 });
    });

    it("lets an object go a day after it was written, unless it was kept", async () => {
      const store = await storeOf();
      const prefix = `files/${randomUUID()}/`;
      const lapses = pathnameIn(prefix);
      const kept = pathnameIn(prefix);
      await store.put(lapses, TEN, "image/png");
      await store.put(kept, TEN, "image/png");
      const written = await store.head(kept);
      expect(written?.expiresAt).toBeGreaterThan(Date.now());
      await store.keep(kept);
      await expect(store.head(kept)).resolves.toMatchObject({ expiresAt: null });

      vi.useFakeTimers({ now: Date.now() + DAY_MS + 1000, toFake: ["Date"] });
      try {
        await expect(store.head(lapses)).resolves.toBeNull();
        await expect(store.read(lapses, null)).resolves.toBeNull();
        await expect(store.keep(lapses)).rejects.toThrow();
        await expect(store.head(kept)).resolves.toMatchObject({ bytes: 10, expiresAt: null });
      } finally {
        vi.useRealTimers();
      }
    });

    it("removes one object, or every object under a prefix", async () => {
      const store = await storeOf();
      const mine = `files/${randomUUID()}/`;
      const theirs = `files/${randomUUID()}/`;
      const [first, second, other] = [pathnameIn(mine), pathnameIn(mine), pathnameIn(theirs)];
      for (const pathname of [first, second, other]) {
        await store.put(pathname, TEN, "image/png");
      }
      await store.remove(first);
      await expect(store.head(first)).resolves.toBeNull();
      await store.remove(first);
      await store.removePrefix(mine);
      await expect(store.head(second)).resolves.toBeNull();
      await expect(store.head(other)).resolves.toMatchObject({ bytes: 10 });
    });

    it("answers no object at a pathname it never held", async () => {
      const store = await storeOf();
      const pathname = pathnameIn(`files/${randomUUID()}/`);
      await expect(store.head(pathname)).resolves.toBeNull();
      await expect(store.read(pathname, null)).resolves.toBeNull();
    });
  });
};

const folders: string[] = [];

afterAll(async () => {
  for (const folder of folders) {
    await rm(folder, { force: true, recursive: true });
  }
});

storeContract("the folder on disk", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "inteligir-store-"));
  folders.push(folder);
  return diskFileStore(folder);
});

describe("the folder on disk alone", () => {
  it("takes an upload as it streams in, once, and refuses one past its size", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "inteligir-store-"));
    folders.push(folder);
    const store = diskFileStore(folder);
    const pathname = `files/${randomUUID()}/${"b".repeat(64)}/${randomUUID()}`;
    await expect(
      store.receive(pathname, twoChunks(), { maxBytes: 9, mime: "image/png" }),
    ).resolves.toBe("too-large");
    await expect(store.head(pathname)).resolves.toBeNull();
    await expect(
      store.receive(pathname, twoChunks(), { maxBytes: 10, mime: "image/png" }),
    ).resolves.toBe("stored");
    await expect(
      store.receive(pathname, twoChunks(), { maxBytes: 10, mime: "image/png" }),
    ).resolves.toBe("exists");
    await expect(store.head(pathname)).resolves.toMatchObject({ bytes: 10, mime: "image/png" });
  });

  it("refuses a pathname outside its folder", async () => {
    const store = diskFileStore(await mkdtemp(path.join(tmpdir(), "inteligir-store-")));
    await expect(store.put("../escape", TEN, "image/png")).rejects.toThrow(/outside/u);
  });
});
