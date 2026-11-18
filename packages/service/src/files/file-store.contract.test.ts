// What every file store keeps to (`./file-store`): an object written once and never over, read
// whole or by range, expiring until it is kept, its folders named, and let go one at a time or by a
// prefix past a page of the store's listing. The folder on disk keeps to it on every run; private Vercel Blob
// does too on a run given the store's key, which CI never is, so the real store is proven without a
// secret in CI.

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, inject, it, vi } from "vitest";

import { blobFileStore } from "./blob-file-store";
import { diskFileStore } from "./disk-file-store";
import type { FileStore } from "./file-store";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TEN = new TextEncoder().encode("0123456789");
// a listing's page is 1,000 objects, Blob's own, so this many cross one, and ten of a removal's
// batches
const PAST_A_PAGE = 1001;
// objects written at once, well under Blob's 75 writes a second on Pro
const AT_ONCE = 5;
// one test writes PAST_A_PAGE objects, which at AT_ONCE takes Blob about a minute, and removes them
// at Blob's pace, which takes another
const PAGE_TEST_MS = 300_000;

// every object a run writes sits under a root of its own, which goes as the run ends: a real store
// keeps what the run kept
const RUN = `suite-${randomUUID()}/`;

const BLOB_TOKEN = inject("blobReadWriteToken").trim();

const DISK_FOLDER = mkdtempSync(path.join(tmpdir(), "inteligir-store-"));

const text = async (body: ReadableStream<Uint8Array>): Promise<string> =>
  await new Response(body).text();

const prefixIn = () => `${RUN}files/${randomUUID()}/`;

const pathnameIn = (prefix: string) => `${prefix}${"a".repeat(64)}/${randomUUID()}`;

// `count` objects of ten bytes under `prefix`, a few at a time; their pathnames in order
const putMany = async (store: FileStore, prefix: string, count: number): Promise<string[]> => {
  const pathnames = Array.from({ length: count }, () => pathnameIn(prefix));
  for (let at = 0; at < count; at += AT_ONCE) {
    await Promise.all(
      pathnames.slice(at, at + AT_ONCE).map(async (pathname) => {
        await store.put(pathname, TEN, "image/png");
      }),
    );
  }
  return pathnames;
};

// the ten bytes sent as an upload streams them, in two chunks
const twoChunks = async function* twoChunks() {
  yield await Promise.resolve(TEN.subarray(0, 4));
  yield TEN.subarray(4);
};

const storeContract = (name: string, storeOf: () => FileStore, { skip = false } = {}) => {
  describe.skipIf(skip)(name, () => {
    afterAll(async () => {
      await storeOf().removePrefix(RUN, Date.now() + PAGE_TEST_MS);
    });

    it("writes an object once, reads it whole or by range, and never writes over it", async () => {
      const store = storeOf();
      const pathname = pathnameIn(prefixIn());
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

    it("expires an object until it is kept, and keeps only an object it holds", async () => {
      const store = storeOf();
      const kept = pathnameIn(prefixIn());
      await store.put(kept, TEN, "image/png");
      const written = await store.head(kept);
      expect(written?.expiresAt).toBeGreaterThan(Date.now());
      await store.keep(kept);
      await expect(store.head(kept)).resolves.toMatchObject({ bytes: 10, expiresAt: null });
      await expect(store.keep(pathnameIn(prefixIn()))).rejects.toThrow();
    });

    it(
      "removes one object, or every object under a prefix past a page of its listing",
      async () => {
        const store = storeOf();
        const mine = prefixIn();
        const [other] = await putMany(store, prefixIn(), 1);
        const pathnames = await putMany(store, mine, PAST_A_PAGE);
        const [first, second] = pathnames;
        await store.remove(first ?? "");
        await expect(store.head(first ?? "")).resolves.toBeNull();
        await store.remove(first ?? "");
        await expect(store.removePrefix(mine, Date.now() + PAGE_TEST_MS)).resolves.toBe("emptied");
        for (const pathname of [second, pathnames[PAST_A_PAGE - 2], pathnames.at(-1)]) {
          await expect(store.head(pathname ?? "")).resolves.toBeNull();
        }
        await expect(store.head(other ?? "")).resolves.toMatchObject({ bytes: 10 });
      },
      PAGE_TEST_MS,
    );

    it("names the folders directly under a prefix, each as a prefix of its own", async () => {
      const store = storeOf();
      const root = `${RUN}tree-${randomUUID()}/`;
      await store.put(`${root}a/one`, TEN, "image/png");
      await store.put(`${root}b/c/two`, TEN, "image/png");
      const folders = await store.folders(root);
      expect(folders.toSorted()).toStrictEqual([`${root}a/`, `${root}b/`]);
      await expect(store.folders(`${RUN}none-${randomUUID()}/`)).resolves.toStrictEqual([]);
    });

    it("answers no object at a pathname it never held", async () => {
      const store = storeOf();
      const pathname = pathnameIn(prefixIn());
      await expect(store.head(pathname)).resolves.toBeNull();
      await expect(store.read(pathname, null)).resolves.toBeNull();
    });
  });
};

afterAll(async () => {
  await rm(DISK_FOLDER, { force: true, recursive: true });
});

storeContract("the folder on disk", () => diskFileStore(DISK_FOLDER));

storeContract("private Vercel Blob", () => blobFileStore(BLOB_TOKEN), { skip: BLOB_TOKEN === "" });

describe("the folder on disk alone", () => {
  it("lets an object go a day after it was written, unless it was kept", async () => {
    const store = diskFileStore(DISK_FOLDER);
    const prefix = prefixIn();
    const lapses = pathnameIn(prefix);
    const kept = pathnameIn(prefix);
    await store.put(lapses, TEN, "image/png");
    await store.put(kept, TEN, "image/png");
    await store.keep(kept);

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

  it("takes an upload as it streams in, once, and refuses one past its size", async () => {
    const store = diskFileStore(DISK_FOLDER);
    const pathname = `${prefixIn()}${"b".repeat(64)}/${randomUUID()}`;
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
    const store = diskFileStore(DISK_FOLDER);
    await expect(store.put("../escape", TEN, "image/png")).rejects.toThrow(/outside/u);
  });
});

// a device's PUT to its ticket, as every app sends one
const send = async (url: string, body: Uint8Array<ArrayBuffer>, mime: string) =>
  await fetch(url, {
    body,
    credentials: "omit",
    headers: { "content-type": mime },
    method: "PUT",
  });

describe.skipIf(BLOB_TOKEN === "")("private Vercel Blob alone", () => {
  it("takes a device's upload at its ticket once, at the size and type it names", async () => {
    const store = blobFileStore(BLOB_TOKEN);
    const pathname = pathnameIn(prefixIn());
    const ticket = await store.uploadTicket({
      bytes: 10,
      mime: "image/png",
      pathname,
      validUntil: Date.now() + HOUR_MS,
    });
    expect(ticket.headers).toStrictEqual({ "content-type": "image/png" });
    await expect(send(ticket.url, new Uint8Array(11), "image/png")).resolves.toMatchObject({
      ok: false,
    });
    await expect(send(ticket.url, new Uint8Array(TEN), "text/plain")).resolves.toMatchObject({
      ok: false,
    });
    await expect(send(ticket.url, new Uint8Array(TEN), "image/png")).resolves.toMatchObject({
      ok: true,
    });
    await expect(send(ticket.url, new Uint8Array(TEN), "image/png")).resolves.toMatchObject({
      ok: false,
    });
    const object = await store.head(pathname);
    expect(object).toMatchObject({ bytes: 10, mime: "image/png" });
    expect(object?.expiresAt).toBeGreaterThan(Date.now());
  });
});
