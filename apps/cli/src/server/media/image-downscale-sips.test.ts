// the macOS downscale's rules over a stand-in for sips (so they are proved off macOS too), and the
// real tool on a Mac: two at once, 64 waiting at most, an SVG passed through, a small picture kept
// as it is, and a large one resized to its long edge.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { createImageDownscale } from "./image-downscale";
import type { SipsRunner } from "./image-downscale";

const failing: SipsRunner = async () => await Promise.reject(new Error("sips failed"));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// a stand-in that reports `width`×`height` and, asked to convert, writes `converted`
const fakeSips =
  (
    width: number,
    height: number,
    options: { alpha?: boolean; gate?: Promise<true>; calls?: string[][] } = {},
  ): SipsRunner =>
  async (args) => {
    options.calls?.push([...args]);
    if (options.gate !== undefined) {
      await options.gate;
    }
    if (args[0] === "-g") {
      return `${args.at(-1) ?? ""}\n  pixelWidth: ${String(width)}\n  pixelHeight: ${String(height)}\n  hasAlpha: ${options.alpha === true ? "yes" : "no"}\n`;
    }
    writeFileSync(args.at(-1) ?? "", "converted");
    return "";
  };

describe("the macOS downscale's rules", () => {
  it("keeps a picture already within the edge as it is", async () => {
    const downscale = createImageDownscale({ platform: "darwin", sips: fakeSips(320, 200) });
    expect(await downscale(PNG, "image/png", 640)).toEqual({ bytes: PNG, mediaType: "image/png" });
  });

  it("resizes a larger one to its long edge, as JPEG unless it has alpha", async () => {
    const calls: string[][] = [];
    const downscale = createImageDownscale({
      platform: "darwin",
      sips: fakeSips(4000, 3000, { calls }),
    });
    const resized = await downscale(PNG, "image/png", 640);
    expect(resized?.mediaType).toBe("image/jpeg");
    expect(new TextDecoder().decode(resized?.bytes)).toBe("converted");
    expect(calls[1]).toEqual(
      expect.arrayContaining(["-s", "format", "jpeg", "formatOptions", "80", "-Z", "640"]),
    );
    const alpha = createImageDownscale({
      platform: "darwin",
      sips: fakeSips(4000, 3000, { alpha: true }),
    });
    const kept = await alpha(PNG, "image/png", 640);
    expect(kept?.mediaType).toBe("image/png");
  });

  it("turns a small HEIC, which no page draws, into a JPEG", async () => {
    const downscale = createImageDownscale({ platform: "darwin", sips: fakeSips(200, 100) });
    const converted = await downscale(PNG, "image/heic", 640);
    expect(converted?.mediaType).toBe("image/jpeg");
  });

  it("passes an SVG of 256 KiB or less through, and refuses a larger one", async () => {
    const downscale = createImageDownscale({ platform: "darwin", sips: fakeSips(1, 1) });
    const svg = new TextEncoder().encode("<svg/>");
    expect(await downscale(svg, "image/svg+xml", 640)).toEqual({
      bytes: svg,
      mediaType: "image/svg+xml",
    });
    expect(await downscale(new Uint8Array(256 * 1024 + 1), "image/svg+xml", 640)).toBeNull();
  });

  it("runs two at once and refuses a call that finds 64 waiting", async () => {
    const gate = Promise.withResolvers<true>();
    const calls: string[][] = [];
    const downscale = createImageDownscale({
      platform: "darwin",
      sips: fakeSips(4000, 3000, { calls, gate: gate.promise }),
    });
    const pending = Array.from({ length: 66 }, async () => await downscale(PNG, "image/png", 640));
    // the first two each write their input before the tool runs, however long a loaded runner
    // takes over it; once both are in, no third starts while they hold
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    await setTimeout(20);
    expect(calls).toHaveLength(2);
    expect(await downscale(PNG, "image/png", 640)).toBeNull();
    gate.resolve(true);
    const answers = await Promise.all(pending);
    expect(answers.every((answer) => answer?.mediaType === "image/jpeg")).toBe(true);
  });

  it("answers null for a type it cannot read and when the tool fails", async () => {
    const downscale = createImageDownscale({ platform: "darwin", sips: failing });
    expect(await downscale(PNG, "image/png", 640)).toBeNull();
    expect(await downscale(PNG, "application/pdf", 640)).toBeNull();
  });
});

describe.skipIf(process.platform !== "darwin")("the system's sips", () => {
  it("resizes a real picture to its long edge", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sips-test-"));
    try {
      const source = path.join(dir, "big.png");
      execFileSync("/usr/bin/sips", [
        "-s",
        "format",
        "png",
        "-z",
        "1200",
        "1600",
        "/System/Library/CoreServices/DefaultDesktop.heic",
        "--out",
        source,
      ]);
      const downscale = createImageDownscale({ platform: "darwin" });
      const resized = await downscale(new Uint8Array(readFileSync(source)), "image/png", 640);
      expect(resized).not.toBeNull();
      const out = path.join(dir, `out.${resized?.mediaType === "image/png" ? "png" : "jpg"}`);
      writeFileSync(out, resized?.bytes ?? new Uint8Array());
      const info = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", out], {
        encoding: "utf-8",
      });
      expect(info).toMatch(/pixelWidth: 640/u);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
