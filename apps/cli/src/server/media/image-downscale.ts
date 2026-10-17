// one downscaler for the whole server: a cover the fill keeps and a grid thumbnail the thumb route
// serves both go through it, so the process limit on the system's image tool is one queue. On
// macOS that tool is `sips`, at most two at once and 64 waiting (a grid scrolled through thousands
// of covers falls back to the originals rather than forking thousands of processes); elsewhere
// nothing resizes, so a small raster passes through as it is and anything else is no answer.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

type DownscaledType = (typeof MEDIA_TYPES)[number];

// what passes through untouched where nothing can resize it: a raster, never an SVG, whose
// passthrough is the macOS path's alone (§4.5)
const RASTER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

type RasterType = (typeof RASTER_TYPES)[number];

export type ImageDownscale = (
  bytes: Uint8Array,
  mediaType: string,
  maxEdge: number,
) => Promise<{ bytes: Uint8Array; mediaType: DownscaledType } | null>;

const PASSTHROUGH_MAX_BYTES = 1024 * 1024;
const SVG_PASSTHROUGH_MAX_BYTES = 256 * 1024;
const SIPS = "/usr/bin/sips";
const SIPS_TIMEOUT_MS = 15_000;
const SIPS_AT_ONCE = 2;
const SIPS_WAITING_MAX = 64;
const JPEG_QUALITY = "80";

// what sips is told the input is, by its type; a type it cannot read is no answer
const INPUT_EXTENSIONS = new Map([
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/tiff", "tiff"],
  ["image/webp", "webp"],
]);

const rasterType = (mediaType: string): RasterType | null =>
  RASTER_TYPES.find((type) => type === mediaType.toLowerCase()) ?? null;

// sips answers `<file>\n  pixelWidth: 640\n  pixelHeight: 480\n  hasAlpha: no`
const sipsProperty = (output: string, key: string): string | null =>
  new RegExp(`^\\s*${key}:\\s*(?<value>\\S+)`, "mu").exec(output)?.groups?.value ?? null;

export type SipsRunner = (args: readonly string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

const runSips: SipsRunner = async (args) => {
  const { stdout } = await execFileAsync(SIPS, [...args], { timeout: SIPS_TIMEOUT_MS });
  return stdout;
};

// first in, first out, `limit` at once; a call that finds `waitingMax` already queued is refused
interface Limiter {
  run: <T>(work: () => Promise<T>) => Promise<T | null>;
}

const createLimiter = (limit: number, waitingMax: number): Limiter => {
  let running = 0;
  const waiting: (() => void)[] = [];
  const run = async <T>(work: () => Promise<T>): Promise<T | null> => {
    if (running >= limit) {
      if (waiting.length >= waitingMax) {
        return null;
      }
      const turn = Promise.withResolvers<true>();
      waiting.push(() => {
        turn.resolve(true);
      });
      await turn.promise;
    }
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
  return { run };
};

const sipsDownscale = (run: SipsRunner): ImageDownscale => {
  const limited = createLimiter(SIPS_AT_ONCE, SIPS_WAITING_MAX);
  const resize = async (bytes: Uint8Array, mediaType: string, maxEdge: number) => {
    const ext = INPUT_EXTENSIONS.get(mediaType.toLowerCase());
    if (ext === undefined) {
      return null;
    }
    const dir = await mkdtemp(path.join(tmpdir(), "inteligir-downscale-"));
    try {
      const input = path.join(dir, `in.${ext}`);
      await writeFile(input, bytes);
      const info = await run(["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", input]);
      const width = Number(sipsProperty(info, "pixelWidth"));
      const height = Number(sipsProperty(info, "pixelHeight"));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      const passes = rasterType(mediaType);
      if (Math.max(width, height) <= maxEdge && passes !== null) {
        return { bytes, mediaType: passes };
      }
      const alpha = sipsProperty(info, "hasAlpha") === "yes";
      const format = alpha ? "png" : "jpeg";
      const output = path.join(dir, `out.${alpha ? "png" : "jpg"}`);
      const resizeArgs = Math.max(width, height) > maxEdge ? ["-Z", String(maxEdge)] : [];
      await run([
        "-s",
        "format",
        format,
        ...(alpha ? [] : ["-s", "formatOptions", JPEG_QUALITY]),
        ...resizeArgs,
        input,
        "--out",
        output,
      ]);
      const resized = new Uint8Array(await readFile(output));
      return {
        bytes: resized,
        mediaType: alpha ? ("image/png" as const) : ("image/jpeg" as const),
      };
    } catch {
      return null;
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  };
  const downscale: ImageDownscale = async (bytes, mediaType, maxEdge) => {
    if (mediaType.toLowerCase() === "image/svg+xml") {
      return bytes.byteLength <= SVG_PASSTHROUGH_MAX_BYTES
        ? { bytes, mediaType: "image/svg+xml" }
        : null;
    }
    return await limited.run(async () => await resize(bytes, mediaType, maxEdge));
  };
  return downscale;
};

const passthroughDownscale: ImageDownscale = async (bytes, mediaType) => {
  const type = rasterType(mediaType);
  if (type === null || bytes.byteLength > PASSTHROUGH_MAX_BYTES) {
    return await Promise.resolve(null);
  }
  return await Promise.resolve({ bytes, mediaType: type });
};

// `sips`: a suite's stand-in for the system tool, so the queue's limits are proved off macOS too
export const createImageDownscale = (args: {
  platform: NodeJS.Platform;
  sips?: SipsRunner;
}): ImageDownscale => {
  if (args.sips !== undefined) {
    return sipsDownscale(args.sips);
  }
  return args.platform === "darwin" ? sipsDownscale(runSips) : passthroughDownscale;
};
