import type { WikiTargetWire } from "@repo/api/local/knowledge/knowledge-schema";
import { describe, expect, it } from "vitest";

import { createNoteFormulas } from "../note-formulas";

const LISTING: readonly WikiTargetWire[] = [
  { id: "id-a", path: "a.md", title: "a", type: "doc" },
  { id: "id-b", path: "b.md", title: "b", type: "doc" },
  { id: "id-c", path: "c.md", title: "c", type: "doc" },
];

const DISK = new Map([
  ["a.md", "---\nid: id-a\n---\n\n{{1|1|id=fa;name=a}}\n"],
  ["b.md", "---\nid: id-b\n---\n\n{{2|2|id=fb;name=b}}\n"],
  ["c.md", "---\nid: id-c\n---\n\n{{3|3|id=fc;name=c}}\n"],
]);

const overVault = (listing: readonly WikiTargetWire[] = LISTING) => {
  const reads: string[] = [];
  const formulas = createNoteFormulas({
    listTargets: async () => await Promise.resolve(listing),
    readFile: async (path) => {
      reads.push(path);
      const content = DISK.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT ${path}`);
      }
      return await Promise.resolve(content);
    },
  });
  return { formulas, reads };
};

describe("a formula's foreign note", () => {
  it("is found by id in the listing and costs one read of that note alone", async () => {
    const { formulas, reads } = overVault();

    const answer = await formulas.read({ noteId: "id-b" });

    expect(answer?.path).toBe("b.md");
    expect(answer?.formulas.map((formula) => formula.meta.id)).toEqual(["fb"]);
    expect(reads).toEqual(["b.md"]);
  });

  it("answers null for an id no listed doc holds, reading nothing", async () => {
    const { formulas, reads } = overVault();

    expect(await formulas.read({ noteId: "id-z" })).toBeNull();
    expect(reads).toEqual([]);
  });

  it("is read again only after a change names its path", async () => {
    const { formulas, reads } = overVault();
    await formulas.read({ noteId: "id-b" });
    await formulas.read({ noteId: "id-b" });
    formulas.forget({ kind: "content", path: "a.md" });
    formulas.forget({ kind: "files", paths: ["c.md"] });
    await formulas.read({ noteId: "id-b" });
    expect(reads).toEqual(["b.md"]);

    formulas.forget({ kind: "content", path: "b.md" });
    await formulas.read({ noteId: "id-b" });
    formulas.forget({ kind: "files", paths: null });
    await formulas.read({ noteId: "id-b" });
    expect(reads).toEqual(["b.md", "b.md", "b.md"]);
  });

  it("shares one read between passes that ask at once", async () => {
    const { formulas, reads } = overVault();

    await Promise.all([formulas.read({ noteId: "id-c" }), formulas.read({ noteId: "id-c" })]);

    expect(reads).toEqual(["c.md"]);
  });

  it("does not remember a refused read", async () => {
    const { formulas, reads } = overVault([
      { id: "id-g", path: "gone.md", title: "g", type: "doc" },
    ]);

    expect(await formulas.read({ noteId: "id-g" })).toBeNull();
    expect(await formulas.read({ noteId: "id-g" })).toBeNull();
    expect(reads).toEqual(["gone.md", "gone.md"]);
  });
});
