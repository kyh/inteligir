import { mkdir, readdir, stat, truncate, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { PAGE_COPY_PATH, VAULT_ASSET_PATH, VAULT_THUMB_PATH } from "@repo/contract/local/routes";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../test-support/boot-app";
import { identityLock } from "../test-support/identity-lock";
import { ignoreFromDisk } from "../test-support/ignore-from-disk";
import { makeTempDir } from "../test-support/temp-dir";
import { createImageDownscale } from "../media/image-downscale";
import type { ImageDownscale } from "../media/image-downscale";
import { createThumbCache, THUMB_CACHE_MAX_BYTES } from "./thumb-cache";
import { handleVaultThumb } from "./thumb-route";
import { createVaultService } from "./vault-service";

const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10];

// a png's signature and then `size` bytes in all, each its own offset's low byte, so a range read
// says exactly which bytes it answered
const pngOf = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = PNG_HEADER[index] ?? index % 256;
  }
  return bytes;
};

const bytesOf = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer());

const lengthOf = async (response: Response): Promise<number> => {
  const bytes = await bytesOf(response);
  return bytes.byteLength;
};

const sizeOf = async (file: string): Promise<number> => {
  const stats = await stat(file);
  return stats.size;
};

describe("the asset route", () => {
  it("answers a byte range 206 with its content-range, and a range past the end 416", async () => {
    const { request, vaultDir } = await bootTestApp();
    const video = pngOf(1000);
    await writeFile(path.join(vaultDir, "clip.mp4"), video);

    const probe = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { range: "bytes=0-1" },
    });
    expect(probe.status).toBe(206);
    expect(probe.headers.get("content-range")).toBe("bytes 0-1/1000");
    expect(probe.headers.get("content-length")).toBe("2");
    expect(probe.headers.get("content-type")).toBe("video/mp4");
    expect(probe.headers.get("accept-ranges")).toBe("bytes");
    expect(await bytesOf(probe)).toEqual(video.slice(0, 2));

    const tail = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { range: "bytes=990-" },
    });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe("bytes 990-999/1000");
    expect(await bytesOf(tail)).toEqual(video.slice(990));

    const past = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { range: "bytes=1000-" },
    });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */1000");

    // a stale if-range: the pieces the player holds are of another version, so it gets the whole
    const stale = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { "if-range": '"stale"', range: "bytes=0-1" },
    });
    expect(stale.status).toBe(200);
    expect(await bytesOf(stale)).toEqual(video);

    const whole = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''clip.mp4");
    expect(await bytesOf(whole)).toEqual(video);
  });

  it("answers a range that also revalidates with its range, and a bare revalidation 304", async () => {
    const { request, vaultDir } = await bootTestApp();
    const video = pngOf(1000);
    await writeFile(path.join(vaultDir, "clip.mp4"), video);
    const first = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`);
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");

    // a media loader sends the etag it holds with every range it reads
    const probe = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { "if-none-match": etag, range: "bytes=0-1" },
    });
    expect(probe.status).toBe(206);
    expect(probe.headers.get("content-range")).toBe("bytes 0-1/1000");
    expect(await bytesOf(probe)).toEqual(video.slice(0, 2));

    const rest = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { "if-none-match": etag, range: "bytes=2-" },
    });
    expect(rest.status).toBe(206);
    expect(await bytesOf(rest)).toEqual(video.slice(2));

    // the existing range rules still hold under the etag: past the end is 416, a stale if-range
    // the whole file
    const past = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { "if-none-match": etag, range: "bytes=1000-" },
    });
    expect(past.status).toBe(416);
    const stale = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { "if-none-match": etag, "if-range": '"stale"', range: "bytes=0-1" },
    });
    expect(stale.status).toBe(200);
    expect(await bytesOf(stale)).toEqual(video);

    const revalidated = await request(`${VAULT_ASSET_PATH}?path=clip.mp4`, {
      headers: { "if-none-match": etag },
    });
    expect(revalidated.status).toBe(304);
    expect(await lengthOf(revalidated)).toBe(0);
  });

  it("answers HEAD with the length and no body", async () => {
    const { request, vaultDir } = await bootTestApp();
    await writeFile(path.join(vaultDir, "song.mp3"), pngOf(300));

    const head = await request(`${VAULT_ASSET_PATH}?path=song.mp3`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("300");
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(head.headers.get("etag")).not.toBeNull();
    expect(await lengthOf(head)).toBe(0);

    const ranged = await request(`${VAULT_ASSET_PATH}?path=song.mp3`, {
      headers: { range: "bytes=0-1" },
      method: "HEAD",
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 0-1/300");
  });

  it("serves a PDF with a policy WebKit's viewer draws under, and every other kind sandboxed", async () => {
    const { request, vaultDir } = await bootTestApp();
    await writeFile(path.join(vaultDir, "Lecture notes.pdf"), "%PDF-1.4\n");
    await writeFile(path.join(vaultDir, "shot.png"), pngOf(20));

    const pdf = await request(
      `${VAULT_ASSET_PATH}?path=${encodeURIComponent("Lecture notes.pdf")}`,
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const policy = pdf.headers.get("content-security-policy") ?? "";
    expect(policy).toBe(
      "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    );
    expect(policy).not.toContain("sandbox");
    expect(pdf.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''Lecture%20notes.pdf",
    );

    const png = await request(`${VAULT_ASSET_PATH}?path=shot.png`);
    expect(png.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("refuses an .html file and an archive: the table says what is served", async () => {
    const { request, vaultDir } = await bootTestApp();
    await mkdir(path.join(vaultDir, "assets", "pages"), { recursive: true });
    await writeFile(path.join(vaultDir, "assets", "pages", "0123456789abcdef.html"), "<p>hi</p>");
    await writeFile(path.join(vaultDir, "archive.zip"), "PK");

    const html = await request(
      `${VAULT_ASSET_PATH}?path=${encodeURIComponent("assets/pages/0123456789abcdef.html")}`,
    );
    expect(html.status).toBe(400);
    const zip = await request(`${VAULT_ASSET_PATH}?path=archive.zip`);
    expect(zip.status).toBe(400);
  });
});

describe("the page-copy route", () => {
  it("serves a copy under its script-less sandbox", async () => {
    const { request, vaultDir } = await bootTestApp();
    const copyPath = "assets/pages/0123456789abcdef.html";
    await mkdir(path.join(vaultDir, "assets", "pages"), { recursive: true });
    await writeFile(
      path.join(vaultDir, copyPath),
      "<p>kept</p><script>parent.postMessage(1)</script>",
    );

    const copy = await request(`${PAGE_COPY_PATH}?path=${encodeURIComponent(copyPath)}`);
    expect(copy.status).toBe(200);
    expect(copy.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:",
    );
    expect(copy.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(copy.headers.get("x-content-type-options")).toBe("nosniff");
    expect(copy.headers.get("referrer-policy")).toBe("no-referrer");
    expect(copy.headers.get("cache-control")).toBe("no-cache");
    expect(await copy.text()).toContain("<p>kept</p>");

    const etag = copy.headers.get("etag") ?? "";
    const revalidated = await request(`${PAGE_COPY_PATH}?path=${encodeURIComponent(copyPath)}`, {
      headers: { "if-none-match": etag },
    });
    expect(revalidated.status).toBe(304);
  });

  it("serves no html outside the copies' folder, nor a copy nested below it", async () => {
    const { request, vaultDir } = await bootTestApp();
    await mkdir(path.join(vaultDir, "assets", "pages", "deeper"), { recursive: true });
    await writeFile(path.join(vaultDir, "page.html"), "<p>x</p>");
    await writeFile(path.join(vaultDir, "assets", "pages", "deeper", "a.html"), "<p>x</p>");
    await writeFile(path.join(vaultDir, "assets", "pages", "a.png"), pngOf(20));

    for (const refused of [
      "page.html",
      "assets/pages/deeper/a.html",
      "assets/pages/a.png",
      "assets/pages/../../page.html",
    ]) {
      const answer = await request(`${PAGE_COPY_PATH}?path=${encodeURIComponent(refused)}`);
      expect(answer.status, refused).toBe(400);
    }
    const missing = await request(
      `${PAGE_COPY_PATH}?path=${encodeURIComponent("assets/pages/ffffffffffffffff.html")}`,
    );
    expect(missing.status).toBe(404);
  });
});

describe("the thumb route", () => {
  it("serves a cached thumbnail, and the original or nothing when nothing could resize it", async () => {
    // the downscale where nothing resizes, named rather than this host's, since the Mac's own tool
    // refuses these unreadable PNGs: it passes a small raster through and answers null otherwise
    const { request, vaultDir, dataDir } = await bootTestApp({
      downscale: createImageDownscale({ platform: "linux" }),
    });
    await writeFile(path.join(vaultDir, "small.png"), pngOf(100));
    await writeFile(path.join(vaultDir, "medium.png"), pngOf(1536 * 1024));
    await writeFile(path.join(vaultDir, "large.png"), pngOf(3 * 1024 * 1024));
    await writeFile(path.join(vaultDir, "photo.heic"), pngOf(100));
    await writeFile(path.join(vaultDir, "notes.pdf"), "%PDF-1.4\n");

    const small = await request(`${VAULT_THUMB_PATH}?path=small.png&w=320`);
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/png");
    expect(small.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(await readdir(path.join(dataDir, "thumbs"))).toHaveLength(1);
    const etag = small.headers.get("etag") ?? "";
    const revalidated = await request(`${VAULT_THUMB_PATH}?path=small.png&w=320`, {
      headers: { "if-none-match": etag },
    });
    expect(revalidated.status).toBe(304);
    // another width is another thumbnail
    const wider = await request(`${VAULT_THUMB_PATH}?path=small.png&w=640`);
    expect(wider.headers.get("etag")).not.toBe(etag);

    const medium = await request(`${VAULT_THUMB_PATH}?path=medium.png&w=320`);
    expect(medium.status).toBe(200);
    expect(await lengthOf(medium)).toBe(1536 * 1024);

    const large = await request(`${VAULT_THUMB_PATH}?path=large.png&w=320`);
    expect(large.status).toBe(404);
    // an image the page cannot draw and nothing here could convert
    const heic = await request(`${VAULT_THUMB_PATH}?path=photo.heic&w=320`);
    expect(heic.status).toBe(404);

    const pdf = await request(`${VAULT_THUMB_PATH}?path=notes.pdf&w=320`);
    expect(pdf.status).toBe(400);
    const width = await request(`${VAULT_THUMB_PATH}?path=small.png&w=100`);
    expect(width.status).toBe(400);
  });

  it("makes one downscale for three requests of one key at once", async () => {
    const root = makeTempDir("inteligir-thumb-");
    const dataDir = makeTempDir("inteligir-thumb-data-");
    await writeFile(path.join(root, "cover.png"), pngOf(64));
    const service = createVaultService({ ignore: ignoreFromDisk(root), lock: identityLock, root });
    const release = Promise.withResolvers<null>();
    let calls = 0;
    const downscale: ImageDownscale = async (bytes) => {
      calls += 1;
      await release.promise;
      return { bytes: bytes.slice(0, 16), mediaType: "image/jpeg" };
    };
    const app = new Hono();
    app.get("/thumb", async (c) => await handleVaultThumb(c, { dataDir, downscale, service }));

    const answers = Promise.all(
      [1, 2, 3].map(async () => await app.request("/thumb?path=cover.png&w=320")),
    );
    // every request reaches the shared make before the downscale answers
    await setTimeout(50);
    release.resolve(null);
    const responses = await answers;
    expect(calls).toBe(1);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(await lengthOf(response)).toBe(16);
    }
    // and the next one is the cache's
    const cached = await app.request("/thumb?path=cover.png&w=320");
    expect(cached.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("prunes the cache oldest first down to its 256 MiB", async () => {
    const dir = makeTempDir("inteligir-thumb-cache-");
    const files = ["a", "b", "c", "d"].map((letter) => path.join(dir, `${letter.repeat(32)}.jpg`));
    // sparse: a size the stat reports with no disk behind it
    const eachBytes = 100 * 1024 * 1024;
    for (const [index, file] of files.entries()) {
      await writeFile(file, "");
      await truncate(file, eachBytes);
      const at = new Date(Date.UTC(2026, 0, 1 + index));
      await utimes(file, at, at);
    }
    await writeFile(path.join(dir, "not-ours.txt"), "kept");

    const cache = createThumbCache(dir);
    await cache.prune();

    const listed = await readdir(dir);
    const left = listed.toSorted();
    expect(left).toEqual([`${"c".repeat(32)}.jpg`, `${"d".repeat(32)}.jpg`, "not-ours.txt"]);
    let total = 0;
    for (const name of left) {
      total += await sizeOf(path.join(dir, name));
    }
    expect(total).toBeLessThanOrEqual(THUMB_CACHE_MAX_BYTES + 4);

    // a read touches the file, so it outlives one written after it
    expect(await cache.read("c".repeat(32))).not.toBeNull();
    await cache.write("e".repeat(32), { bytes: new Uint8Array(1), mediaType: "image/png" });
    const touched = await stat(path.join(dir, `${"c".repeat(32)}.jpg`));
    expect(touched.mtimeMs).toBeGreaterThan(Date.UTC(2026, 0, 3));
  });
});
