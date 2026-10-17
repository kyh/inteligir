// off macOS nothing resizes an image, so a raster small enough is kept as it is and the rest is
// no answer, which the caller reads as "serve or keep the original"

import { describe, expect, it } from "vitest";

import { createImageDownscale } from "../image-downscale";

const downscale = createImageDownscale({ platform: "linux" });
const SMALL = new Uint8Array([1, 2, 3]);
const OVER = new Uint8Array(1024 * 1024 + 1);

describe("the downscale where no image tool runs", () => {
  it("passes an allowlisted raster of 1 MiB or less through as it is", async () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "IMAGE/PNG"]) {
      expect(await downscale(SMALL, type, 320), type).toEqual({
        bytes: SMALL,
        mediaType: type.toLowerCase(),
      });
    }
  });

  it("answers null for an SVG, a type off the list, and a raster over 1 MiB", async () => {
    expect(await downscale(SMALL, "image/svg+xml", 320)).toBeNull();
    expect(await downscale(SMALL, "image/heic", 320)).toBeNull();
    expect(await downscale(OVER, "image/png", 320)).toBeNull();
  });
});
