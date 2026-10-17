import { describe, expect, it } from "vitest";

import type { ExtractedLink } from "../../knowledge/link-extract";
import { itemFilesOf } from "../item-files";
import type { ItemKind } from "../item-kind";

const embed = (target: string): ExtractedLink => ({ embed: true, kind: "image", line: 1, target });
const link = (target: string): ExtractedLink => ({ embed: false, kind: "md", line: 1, target });

// every target resolves to itself unless it is a doc or named missing
const filesOf = (
  kind: ItemKind,
  links: readonly ExtractedLink[],
  missing: readonly string[] = [],
) =>
  itemFilesOf({
    kind,
    links,
    resolve: (l) => (l.target.endsWith(".md") || missing.includes(l.target) ? null : l.target),
  });

const COVER = "assets/covers/3f9a0c2b1d4e5f60.jpg";

describe("itemFilesOf", () => {
  it("reads a link's cover and page copy, and gives it no original", () => {
    expect(
      filesOf("link", [embed(COVER), link("assets/pages/aa.html"), embed("assets/body.png")]),
    ).toEqual({ copy: "assets/pages/aa.html", cover: COVER, file: null });
  });

  it("takes an image's original past its cover, and falls back to the cover", () => {
    expect(filesOf("image", [embed(COVER), embed("assets/IMG_2041.png")])).toEqual({
      copy: null,
      cover: COVER,
      file: "assets/IMG_2041.png",
    });
    expect(filesOf("image", [embed(COVER)]).file).toBe(COVER);
  });

  it("finds a pdf, a video and an audio file by kind, and a file past the covers", () => {
    expect(filesOf("pdf", [embed("a.png"), embed("assets/Lecture notes.pdf")]).file).toBe(
      "assets/Lecture notes.pdf",
    );
    expect(filesOf("video", [embed("clip.mov")]).file).toBe("clip.mov");
    expect(filesOf("audio", [embed("clip.mov"), embed("song.mp3")]).file).toBe("song.mp3");
    expect(filesOf("file", [embed(COVER), embed("assets/archive.zip")])).toEqual({
      copy: null,
      cover: COVER,
      file: "assets/archive.zip",
    });
    expect(filesOf("note", [embed("assets/archive.zip")]).file).toBeNull();
  });

  it("skips what does not resolve, and reads only the first eight embeds", () => {
    expect(filesOf("link", [embed("gone.png"), embed("there.png")], ["gone.png"]).cover).toBe(
      "there.png",
    );
    const late = [
      ...Array.from({ length: 8 }, (_, i) => embed(`doc${String(i)}.md`)),
      embed("x.png"),
    ];
    expect(filesOf("link", late).cover).toBeNull();
  });

  it("finds a page copy anywhere, and only under the pages folder", () => {
    const many = [...Array.from({ length: 12 }, () => link("x.md")), link("assets/pages/b.html")];
    expect(filesOf("link", many).copy).toBe("assets/pages/b.html");
    expect(filesOf("link", [link("elsewhere/b.html")]).copy).toBeNull();
  });
});
