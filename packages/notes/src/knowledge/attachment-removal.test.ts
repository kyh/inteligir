import { describe, expect, it } from "vitest";
import { attachmentsFreedBy } from "./attachment-removal";

const graph =
  (linkers: Record<string, readonly string[]>) =>
  (file: string): readonly string[] =>
    linkers[file] ?? [];

describe("attachmentsFreedBy", () => {
  it("frees an item's original, cover and copy that only it links", () => {
    const freed = attachmentsFreedBy(
      [
        {
          linked: ["assets/scan.pdf", "assets/covers/3f9a.jpg", "assets/pages/aa.html"],
          path: "Unsorted/Scan.md",
        },
      ],
      graph({
        "assets/covers/3f9a.jpg": ["Unsorted/Scan.md"],
        "assets/pages/aa.html": ["Unsorted/Scan.md"],
        "assets/scan.pdf": ["Unsorted/Scan.md"],
      }),
    );
    expect(freed).toEqual(["assets/scan.pdf", "assets/covers/3f9a.jpg", "assets/pages/aa.html"]);
  });

  it("keeps a file another doc still embeds, and frees one every removed doc shares", () => {
    const freed = attachmentsFreedBy(
      [
        { linked: ["assets/shared.png", "assets/both.png"], path: "a.md" },
        { linked: ["assets/both.png"], path: "b.md" },
      ],
      graph({
        "assets/both.png": ["a.md", "b.md"],
        "assets/shared.png": ["a.md", "kept.md"],
      }),
    );
    expect(freed).toEqual(["assets/both.png"]);
  });

  it("keeps a file whose linkers the caller has not read", () => {
    // the graph does not even know the removed doc links it: a doc whose text has not arrived
    expect(attachmentsFreedBy([{ linked: ["assets/x.png"], path: "a.md" }], graph({}))).toEqual([]);
    expect(
      attachmentsFreedBy(
        [{ linked: ["assets/x.png"], path: "a.md" }],
        graph({ "assets/x.png": ["other.md"] }),
      ),
    ).toEqual([]);
  });

  it("never frees a note or a dot-path, whatever the caller named", () => {
    const freed = attachmentsFreedBy(
      [{ linked: ["linked.md", ".inteligir/annotations/x.json", "assets/a.png"], path: "a.md" }],
      graph({
        ".inteligir/annotations/x.json": ["a.md"],
        "assets/a.png": ["a.md"],
        "linked.md": ["a.md"],
      }),
    );
    expect(freed).toEqual(["assets/a.png"]);
  });

  it("names each file once", () => {
    const freed = attachmentsFreedBy(
      [
        { linked: ["assets/a.png", "assets/a.png"], path: "a.md" },
        { linked: ["assets/a.png"], path: "b.md" },
      ],
      graph({ "assets/a.png": ["a.md", "b.md"] }),
    );
    expect(freed).toEqual(["assets/a.png"]);
  });
});
