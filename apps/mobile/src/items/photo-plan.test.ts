import { describe, expect, it } from "vitest";

import { photoName, photoResize, photoType } from "./photo-plan";

describe("what a photo becomes", () => {
  it.each([
    ["image/png", "image/png"],
    ["IMAGE/PNG", "image/png"],
    ["image/jpeg", "image/jpeg"],
    ["image/heic", "image/jpeg"],
    [undefined, "image/jpeg"],
    [null, "image/jpeg"],
  ])("takes %s as %s", (picked, type) => {
    expect(photoType(picked)).toBe(type);
  });

  it("names the file by its type", () => {
    const takenAt = new Date(2026, 10, 6, 9, 5, 7);
    expect(photoName(takenAt, "image/jpeg")).toBe("Photo 2026-11-06 09.05.07.jpg");
    expect(photoName(takenAt, "image/png")).toBe("Photo 2026-11-06 09.05.07.png");
  });

  it("scales the long edge down to 2048, and never up", () => {
    expect(photoResize(4096, 2048)).toStrictEqual({ height: 1024, width: 2048 });
    expect(photoResize(2048, 1000)).toBeNull();
  });
});
