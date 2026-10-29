import { scanDoc } from "@repo/notes/knowledge/link-extract";
import type { ExtractedLink } from "@repo/notes/knowledge/link-extract";
import { describe, expect, it } from "vitest";
import { heldByDoc } from "./held-files";
import type { DeletedPath } from "./held-files";

const linksIn =
  (texts: Record<string, string>) =>
  (doc: string): readonly ExtractedLink[] =>
    scanDoc(texts[doc] ?? "").links;

describe("heldByDoc", () => {
  it("holds the files a doc deleted in the same change set embeds or links, by path or by name", () => {
    const deleted: DeletedPath[] = [
      { group: "c1", kind: "doc", path: "Unsorted/Scan.md" },
      { group: "c1", kind: "file", path: "assets/scan.pdf" },
      { group: "c1", kind: "file", path: "assets/covers/3f9a.jpg" },
      { group: "c1", kind: "file", path: "assets/pages/aa.html" },
      { group: "c1", kind: "file", path: "assets/unlinked.png" },
    ];
    const held = heldByDoc(
      deleted,
      linksIn({
        "Unsorted/Scan.md":
          "![](assets/covers/3f9a.jpg)\n\n![[scan.pdf]]\n\n[Copy of the page](assets/pages/aa.html)\n",
      }),
    );
    expect(Object.fromEntries(held)).toEqual({
      "assets/covers/3f9a.jpg": "Unsorted/Scan.md",
      "assets/pages/aa.html": "Unsorted/Scan.md",
      "assets/scan.pdf": "Unsorted/Scan.md",
    });
  });

  it("holds nothing across change sets, and gives a file two docs link to the first by path", () => {
    const deleted: DeletedPath[] = [
      { group: "c1", kind: "doc", path: "b.md" },
      { group: "c1", kind: "doc", path: "a.md" },
      { group: "c1", kind: "file", path: "assets/shared.png" },
      { group: "c2", kind: "file", path: "assets/apart.png" },
    ];
    const held = heldByDoc(
      deleted,
      linksIn({
        "a.md": "![](assets/shared.png)\n![](assets/apart.png)\n",
        "b.md": "![](assets/shared.png)\n",
      }),
    );
    expect(Object.fromEntries(held)).toEqual({ "assets/shared.png": "a.md" });
  });

  it("resolves an md link from the doc's own folder first", () => {
    const deleted: DeletedPath[] = [
      { group: "w", kind: "doc", path: "Reading/Item.md" },
      { group: "w", kind: "file", path: "Reading/pic.png" },
    ];
    const held = heldByDoc(deleted, linksIn({ "Reading/Item.md": "![](pic.png)\n" }));
    expect(held.get("Reading/pic.png")).toBe("Reading/Item.md");
  });
});
