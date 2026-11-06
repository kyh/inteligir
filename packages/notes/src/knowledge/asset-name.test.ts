import { describe, expect, it } from "vitest";
import { freeAssetPathWhere } from "@repo/notes/knowledge/asset-name";
import { takenIgnoringCase } from "@repo/notes/knowledge/doc-file";

// past every path held, compared as a case-insensitive disk compares them
const freeAssetPath = (dir: string, baseName: string, takenPaths: readonly string[]): string =>
  freeAssetPathWhere(dir, baseName, takenIgnoringCase(takenPaths));

describe("freeAssetPathWhere", () => {
  it("keeps a free name as written, its extension lowercased", () => {
    expect(freeAssetPath("assets", "Shot.PNG", [])).toBe("assets/Shot.png");
    expect(freeAssetPath("", "Photo 2026-09-26 14.30.05.jpg", [])).toBe(
      "Photo 2026-09-26 14.30.05.jpg",
    );
  });

  it("steps past a taken name with a numbered one", () => {
    expect(freeAssetPath("assets", "shot.png", ["assets/shot.png", "assets/shot-2.png"])).toBe(
      "assets/shot-3.png",
    );
  });

  it("counts a name taken in other capitals as taken", () => {
    expect(freeAssetPath("assets", "shot.png", ["assets/SHOT.PNG"])).toBe("assets/shot-2.png");
  });

  it("names a file taken only in another folder as it is", () => {
    expect(freeAssetPath("assets", "shot.png", ["shot.png", "other/shot.png"])).toBe(
      "assets/shot.png",
    );
  });

  it("turns what a filename should not carry into hyphens and trims its edges", () => {
    expect(freeAssetPath("assets", "my: shot?*.png", [])).toBe("assets/my- shot.png");
    expect(freeAssetPath("assets", "..hidden..png", [])).toBe("assets/hidden.png");
  });

  it("names a file whose stem is nothing once cleaned 'asset'", () => {
    expect(freeAssetPath("assets", "???.jpg", [])).toBe("assets/asset.jpg");
    expect(freeAssetPath("assets", "", [])).toBe("assets/asset");
  });
});
