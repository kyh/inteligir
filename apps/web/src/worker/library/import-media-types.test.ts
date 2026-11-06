import { FILE_KIND_EXTENSIONS } from "@repo/notes/items/item-kind";
import { describe, expect, it } from "vitest";

import { importMediaType } from "./import-media-types";

describe("an imported file's media type", () => {
  it("names a type for every extension an import makes a picture, PDF, video or sound of", () => {
    const kinded = [
      ...FILE_KIND_EXTENSIONS.audio,
      ...FILE_KIND_EXTENSIONS.image,
      ...FILE_KIND_EXTENSIONS.pdf,
      ...FILE_KIND_EXTENSIONS.video,
    ];
    // HEIC is off the allowlist, so it is stored as bytes of no known type, served under the sandbox
    const untyped = kinded.filter((ext) => ext !== ".heic" && importMediaType(`a${ext}`) === null);
    expect(untyped).toStrictEqual([]);
    expect(importMediaType("a.heic")).toBeNull();
  });

  it("stores an Ogg sound as every other door does", () => {
    expect(["a.ogg", "b.OGA", "c.opus"].map(importMediaType)).toStrictEqual([
      "audio/ogg",
      "audio/ogg",
      "audio/ogg",
    ]);
  });
});
