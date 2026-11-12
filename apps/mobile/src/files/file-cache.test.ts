import { describe, expect, it, vi } from "vitest";
import { deferred } from "@repo/contract/deferred";
import { nextTask } from "../test-support/async";
import { memoryFolder } from "../test-support/memory-folder";
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

// what the cloud serves, by sha: a file's bytes, served as a picture unless the case names a type
type Served = Map<string, Uint8Array<ArrayBuffer> | HeldFile>;

const servedFile = (file: Uint8Array<ArrayBuffer> | HeldFile): HeldFile =>
  file instanceof Uint8Array ? { bytes: file, mime: "image/png" } : file;

const cacheOver = (more: Partial<FileCachePorts> = {}) => {
  const folder = memoryFolder();
  const asked: string[] = [];
  const served: Served = new Map();
  const cache = createFileCache({
    download: async (sha) => {
      asked.push(sha);
      const file = served.get(sha);
      return await Promise.resolve(file === undefined ? null : servedFile(file));
    },
    folder,
    shrink: async () => await Promise.resolve(null),
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
    // a recording's bytes, whose type no sniff of its first bytes would name
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

  it("draws no cover whose header names more pixels than a phone may decode, whatever its file's size", async () => {
    const shrunk: string[] = [];
    const { asked, cache, folder, served } = cacheOver({
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
    expect(folder.held()).toContain(SHA_A);
  });

  it("draws a picture whose header says no size only from a thumbnail, whatever its file's size", async () => {
    const shrunk: string[] = [];
    const { cache, served } = cacheOver({
      shrink: async (_bytes, mime) => {
        shrunk.push(mime);
        return await Promise.resolve(
          shrunk.length === 1 ? { bytes: bytesOf(8), mime: "image/png" } : null,
        );
      },
    });
    served.set(SHA_A, bytesOf(100, AVIF));
    served.set(SHA_B, bytesOf(100, AVIF));

    await expect(cache.thumbUri(SHA_A)).resolves.toBe(`memory://${SHA_A}.thumb`);
    await expect(cache.thumbUri(SHA_B), "no thumbnail, so no drawing").resolves.toBeNull();
    expect(shrunk).toStrictEqual(["image/avif", "image/avif"]);
  });

  it("decodes one cover at a time, however many rows ask at once", async () => {
    const first = deferred<HeldFile | null>();
    const started: number[] = [];
    const { cache, served } = cacheOver({
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
      `memory://${SHA_A}.thumb`,
      `memory://${SHA_B}.thumb`,
    ]);
  });

  it("draws a large cover from a thumbnail made once, and tries an undecodable one once a session", async () => {
    const shrunk: string[] = [];
    const { asked, cache, folder, served } = cacheOver({
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

    await expect(cache.thumbUri(SHA_A)).resolves.toBe(`memory://${SHA_A}.thumb`);
    await expect(cache.thumbUri(SHA_A)).resolves.toBe(`memory://${SHA_A}.thumb`);
    await expect(cache.thumbUri(SHA_B)).resolves.toBeNull();
    await expect(cache.thumbUri(SHA_B)).resolves.toBeNull();
    await expect(cache.thumbUri(SHA_C)).resolves.toBe(`memory://${SHA_C}`);
    expect(shrunk).toStrictEqual(["image/png", "image/png"]);
    expect(folder.held()).toContain(`${SHA_A}.thumb`);
    // each cover crossed once: the bytes a thumbnail was tried from are the ones kept
    expect(asked).toStrictEqual([SHA_A, SHA_B, SHA_C]);
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

    const drawing = [cache.fileUri(SHA_A), cache.fileUri(SHA_A), cache.thumbUri(SHA_A)];
    answer.resolve({ bytes: bytesOf(24, PNG), mime: "image/png" });

    await expect(Promise.all(drawing)).resolves.toStrictEqual([
      `memory://${SHA_A}`,
      `memory://${SHA_A}`,
      `memory://${SHA_A}`,
    ]);
    expect(asked).toStrictEqual([SHA_A]);
  });

  it("keeps a thumbnail's transparency for every source that can carry it", () => {
    expect(thumbFormatOf("image/png")).toBe("png");
    expect(thumbFormatOf("image/webp")).toBe("png");
    expect(thumbFormatOf("image/gif")).toBe("png");
    expect(thumbFormatOf("image/jpeg")).toBe("jpeg");
  });
});
