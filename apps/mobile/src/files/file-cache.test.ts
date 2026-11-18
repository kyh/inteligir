import { describe, expect, it, vi } from "vitest";
import { deferred } from "@repo/contract/deferred";
import type { PixelSize } from "@repo/contract/items/sniff-media";
import { memoryFolder } from "../test-support/memory-folder.test-utils";
import type { MemoryFolder } from "../test-support/memory-folder.test-utils";
import { createFileCache } from "./file-cache";
import type { FileCachePorts, HeldFile } from "./file-cache";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const pngHead = (width: number, height: number) => {
  const head = new Uint8Array(24);
  head.set(PNG);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);

  return head;
};

const AVIF = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);

const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xc8, 0x00]);

const bytesOf = (size: number, head: Uint8Array = new Uint8Array()) => {
  const bytes = new Uint8Array(size);
  bytes.set(head);

  return bytes;
};

type Served = Map<string, Uint8Array<ArrayBuffer> | HeldFile>;

const servedFile = (file: Uint8Array<ArrayBuffer> | HeldFile) =>
  (file instanceof Uint8Array ? { bytes: file, mime: "image/png" } : file) satisfies HeldFile;

const unmeasured = async () => await Promise.reject(new Error("the system was asked for a size"));

const cacheOver = (
  more: Partial<Omit<FileCachePorts, "folder">> = {},
  folder: MemoryFolder = memoryFolder(),
) => {
  const asked: string[] = [];
  const served: Served = new Map();

  const cache = createFileCache({
    download: async (sha) => {
      asked.push(sha);
      const file = served.get(sha);

      return await Promise.resolve(file === undefined ? null : servedFile(file));
    },
    folder,
    measure: unmeasured,
    ...more,
  });

  return { asked, cache, folder, served };
};

describe("the phone's copy of the library's files", () => {
  it("fetches a file the first time a screen draws it, and draws it from the phone after", async () => {
    const { asked, cache, folder, served } = cacheOver();
    served.set(SHA_A, bytesOf(10));

    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
    expect(asked).toStrictEqual([SHA_A]);
    expect(folder.held().toSorted()).toStrictEqual([SHA_A, `${SHA_A}.type`]);
  });

  it("answers a file for the editor page, kept once fetched, and nothing for one the cloud lacks", async () => {
    const { asked, cache, served } = cacheOver();
    served.set(SHA_B, bytesOf(12, PNG));

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
  });

  it("keeps each file's type: kept as it was sent, fetched and drawn again", async () => {
    const { asked, cache, served } = cacheOver();
    const clip = bytesOf(6);
    await cache.keep(SHA_A, { bytes: clip, mime: "video/quicktime" });
    await expect(cache.heldFile(SHA_A)).resolves.toStrictEqual({
      bytes: clip,
      mime: "video/quicktime",
    });

    served.set(SHA_B, { bytes: bytesOf(6), mime: "video/mp4" });
    await expect(cache.heldFile(SHA_B)).resolves.toMatchObject({ mime: "video/mp4" });
    await expect(cache.heldFile(SHA_B), "drawn again from the phone's copy").resolves.toMatchObject(
      { mime: "video/mp4" },
    );
    expect(asked, "what the phone sent is never downloaded").toStrictEqual([SHA_B]);
  });

  it("answers nothing for a file the cloud holds none of, or cannot be reached for", async () => {
    const { cache } = cacheOver({
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

  it("fetches a file the OS purged again", async () => {
    const { asked, cache, folder, served } = cacheOver();
    served.set(SHA_A, bytesOf(4));
    await cache.fileUri(SHA_A);
    await folder.clear();

    await expect(cache.fileUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
    expect(asked).toStrictEqual([SHA_A, SHA_A]);
  });

  it("lands nothing fetched for an account the phone left while it came", async () => {
    const answer = deferred<HeldFile | null>();
    const { cache, folder } = cacheOver({ download: async () => await answer.promise });

    const drawing = cache.fileUri(SHA_A);
    await cache.clear();
    answer.resolve({ bytes: bytesOf(4), mime: "image/png" });

    await expect(drawing).resolves.toBeNull();
    expect(folder.held()).toStrictEqual([]);
  });

  it("draws a cover from the kept file by the size its header names, whatever its file's size", async () => {
    const { asked, cache, folder, served } = cacheOver();
    served.set(SHA_A, bytesOf(4 * 1024 * 1024, pngHead(7000, 7000)));
    served.set(SHA_B, bytesOf(100, pngHead(30_000, 30_000)));

    await expect(cache.coverUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
    await expect(cache.coverUri(SHA_B), "more than a phone may decode").resolves.toBeNull();
    await expect(cache.coverUri(SHA_B), "asked again, for the same answer").resolves.toBeNull();
    expect(asked, "kept, so asking again downloads nothing").toStrictEqual([SHA_A, SHA_B]);
    expect(folder.held()).toContain(SHA_B);
  });

  it("draws no GIF as a cover, whose frames a row would decode whole", async () => {
    const { cache, served } = cacheOver();
    served.set(SHA_A, bytesOf(100, GIF));

    await expect(cache.coverUri(SHA_A)).resolves.toBeNull();
  });

  it("asks the system for the size of a picture whose header names none, and draws it within the same cap", async () => {
    const sizes = new Map<string, PixelSize | null>([
      [`memory://${SHA_A}`, { height: 400, width: 640 }],
      [`memory://${SHA_B}`, { height: 30_000, width: 30_000 }],
      [`memory://${SHA_C}`, null],
    ]);

    const { cache, served } = cacheOver({
      measure: async (uri) => await Promise.resolve(sizes.get(uri) ?? null),
    });

    served.set(SHA_A, bytesOf(100, AVIF));
    served.set(SHA_B, bytesOf(100, AVIF));
    served.set(SHA_C, bytesOf(100, AVIF));

    await expect(cache.coverUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
    await expect(cache.coverUri(SHA_B)).resolves.toBeNull();
    await expect(cache.coverUri(SHA_C), "no picture the system reads").resolves.toBeNull();
  });

  it("judges a cover once: its verdict is kept beside it, for the next launch too", async () => {
    const measured: string[] = [];

    const measure = async (uri: string) => {
      measured.push(uri);

      return await Promise.resolve({ height: 400, width: 640 });
    };

    const { cache, folder, served } = cacheOver({ measure });
    served.set(SHA_A, bytesOf(100, AVIF));
    served.set(SHA_B, bytesOf(100, pngHead(30_000, 30_000)));
    await cache.coverUri(SHA_A);
    await cache.coverUri(SHA_B);

    const relaunched = cacheOver({ measure }, folder);
    await expect(relaunched.cache.coverUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
    await expect(relaunched.cache.coverUri(SHA_B)).resolves.toBeNull();
    expect(measured).toStrictEqual([`memory://${SHA_A}`]);
    expect(relaunched.asked).toStrictEqual([]);
  });

  it("judges a file kept with no verdict from its bytes, as a photo this phone sent is", async () => {
    const { asked, cache } = cacheOver();
    await cache.keep(SHA_A, { bytes: bytesOf(100, pngHead(640, 400)), mime: "image/png" });
    await cache.keep(SHA_B, { bytes: bytesOf(100, pngHead(30_000, 30_000)), mime: "image/png" });

    await expect(cache.coverUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
    await expect(cache.coverUri(SHA_B)).resolves.toBeNull();
    expect(asked).toStrictEqual([]);
  });

  it("keeps no verdict the system could not give, and asks again", async () => {
    let busy = true;

    const { cache, served } = cacheOver({
      measure: async () => {
        if (busy) {
          busy = false;
          throw new Error("busy");
        }

        return await Promise.resolve({ height: 400, width: 640 });
      },
    });

    served.set(SHA_A, bytesOf(100, AVIF));

    await expect(cache.coverUri(SHA_A)).rejects.toThrow("busy");
    await expect(cache.coverUri(SHA_A)).resolves.toBe(`memory://${SHA_A}`);
  });

  it("keeps no verdict for an account the phone left while its cover was measured", async () => {
    const size = deferred<PixelSize | null>();
    const { cache, folder, served } = cacheOver({ measure: async () => await size.promise });
    served.set(SHA_A, bytesOf(100, AVIF));

    const drawing = cache.coverUri(SHA_A);
    await vi.waitFor(() => {
      expect(folder.held()).toContain(SHA_A);
    });
    await cache.clear();
    size.resolve({ height: 400, width: 640 });

    await expect(drawing).resolves.toBeNull();
    expect(folder.held()).toStrictEqual([]);
  });

  it("fetches a file once however many screens ask for it at once", async () => {
    const answer = deferred<HeldFile | null>();
    const asked: string[] = [];

    const { cache } = cacheOver({
      download: async (sha) => {
        asked.push(sha);

        return await answer.promise;
      },
    });

    const drawing = [cache.fileUri(SHA_A), cache.fileUri(SHA_A), cache.coverUri(SHA_A)];
    answer.resolve({ bytes: bytesOf(24, pngHead(640, 400)), mime: "image/png" });

    await expect(Promise.all(drawing)).resolves.toStrictEqual([
      `memory://${SHA_A}`,
      `memory://${SHA_A}`,
      `memory://${SHA_A}`,
    ]);
    expect(asked).toStrictEqual([SHA_A]);
  });
});
